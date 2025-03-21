import React, { useEffect, useRef, useState } from "react";
import { useGameServer, useRoomState, useRoomAllUserStates } from "@agent8/gameserver";
import Phaser from "phaser";
import { GameScene } from "../game/scenes/GameScene";
import { UIScene } from "../game/scenes/UIScene";
import GameUI from "./GameUI";
import RespawnButton from "./RespawnButton";
import GameInstructions from "./GameInstructions";

interface GameComponentProps {
  playerName: string;
  roomId: string;
  onExitGame: () => void;
}

const GameComponent: React.FC<GameComponentProps> = ({ playerName, roomId, onExitGame }) => {
  const gameRef = useRef<HTMLDivElement>(null);
  const gameInstanceRef = useRef<Phaser.Game | null>(null);
  const gameSceneRef = useRef<GameScene | null>(null);
  const { server } = useGameServer();
  const roomState = useRoomState();
  const allPlayers = useRoomAllUserStates();
  const [isPlayerDead, setIsPlayerDead] = useState(false);

  useEffect(() => {
    if (!gameRef.current) return;

    // Initialize Phaser game
    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: gameRef.current,
      width: 800,
      height: 600,
      physics: {
        default: "arcade",
        arcade: {
          gravity: { x: 0, y: 0 },
          debug: false
        }
      },
      scene: [GameScene, UIScene],
      backgroundColor: "#1a1a2e",
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH
      }
    };

    // Create game instance
    gameInstanceRef.current = new Phaser.Game(config);

    // Center the canvas after creation
    const centerCanvas = () => {
      const canvas = gameRef.current?.querySelector('canvas');
      if (canvas) {
        canvas.classList.add('phaser-canvas');
      }
    };

    // Give a small delay to ensure the canvas is created
    setTimeout(centerCanvas, 100);

    // Listen for player death event
    const handlePlayerDeath = () => {
      console.log("Player died: showing respawn UI");
      setIsPlayerDead(true);
    };

    // Add custom event listener for player death
    window.addEventListener('player-died', handlePlayerDeath);

    // Cleanup on unmount
    return () => {
      if (gameInstanceRef.current) {
        gameInstanceRef.current.destroy(true);
        gameInstanceRef.current = null;
        gameSceneRef.current = null;
      }
      window.removeEventListener('player-died', handlePlayerDeath);
    };
  }, []);

  // Pass data to game scene after it's created
  useEffect(() => {
    if (!gameInstanceRef.current || !server || !roomId) return;
    
    // Add a slight delay to ensure the scene is loaded
    const initGameScene = () => {
      try {
        const gameScene = gameInstanceRef.current?.scene.getScene("GameScene") as GameScene;
        if (gameScene) {
          gameSceneRef.current = gameScene;
          gameScene.setGameData({
            playerName,
            roomId,
            server
          });
        } else {
          // If scene is not ready yet, try again
          setTimeout(initGameScene, 100);
        }
      } catch (error) {
        console.error("Error initializing game scene:", error);
        // Try again if error occurs
        setTimeout(initGameScene, 200);
      }
    };
    
    initGameScene();
  }, [playerName, roomId, server]);

  // Update game data when room state changes
  useEffect(() => {
    if (!gameSceneRef.current || !roomState) return;
    
    try {
      if (gameSceneRef.current.scene.isActive()) {
        gameSceneRef.current.updateRoomState(roomState);
      }
    } catch (error) {
      console.error("Error updating room state:", error);
    }
  }, [roomState]);

  // Update player data when player states change
  useEffect(() => {
    if (!gameSceneRef.current || !allPlayers) return;
    
    try {
      if (gameSceneRef.current.scene.isActive()) {
        gameSceneRef.current.updatePlayerStates(allPlayers);
      }
    } catch (error) {
      console.error("Error updating player states:", error);
    }
  }, [allPlayers]);

  // Check if player is dead based on health and explicit isDead flag
  useEffect(() => {
    if (!server || !allPlayers) return;
    
    const myPlayerState = allPlayers.find(player => player.account === server.account);
    if (myPlayerState) {
      // Check both isDead flag and health value
      if ((myPlayerState.isDead === true) || (myPlayerState.health !== undefined && myPlayerState.health <= 0)) {
        console.log("Player state indicates death: showing respawn UI");
        setIsPlayerDead(true);
      } else if (myPlayerState.health > 0 && myPlayerState.isRespawned) {
        // Player has been respawned, hide respawn UI
        console.log("Player has respawned: hiding respawn UI");
        setIsPlayerDead(false);
      }
    }
  }, [allPlayers, server]);

  // Handle respawn button click
  const handleRespawn = () => {
    if (!gameSceneRef.current || !server) return;
    
    console.log("Respawn button clicked: initiating respawn process");
    
    // Generate random position within map boundaries
    const randomX = Math.floor(Math.random() * 1800) + 100; // 100 to 1900
    const randomY = Math.floor(Math.random() * 1800) + 100; // 100 to 1900
    
    // Reset player health and position on the server
    server.remoteFunction("respawnPlayer", [{ x: randomX, y: randomY }]);
    
    // Also call the local respawn method to ensure immediate visual update
    gameSceneRef.current.respawnPlayer(randomX, randomY);
    
    // Hide respawn button
    setIsPlayerDead(false);
    
    console.log("Respawn process completed");
  };

  return (
    <div className="flex flex-col w-full h-screen bg-gray-900">
      {/* Game UI - positioned at the top */}
      <div className="w-full bg-gray-800 bg-opacity-90 p-2 shadow-md z-10">
        <GameUI roomId={roomId} onExitGame={onExitGame} />
      </div>
      
      {/* Game canvas container - positioned in the center */}
      <div className="flex-grow flex flex-col justify-center items-center relative">
        <div className="w-[800px] h-[600px] shadow-lg rounded-lg overflow-hidden">
          <div ref={gameRef} className="w-full h-full" />
        </div>
        
        {/* Game Instructions below the canvas */}
        <GameInstructions className="mt-3" />
        
        {/* Respawn button overlay - positioned over the game canvas */}
        {isPlayerDead && (
          <div className="absolute inset-0 flex items-center justify-center">
            <RespawnButton isVisible={true} onRespawn={handleRespawn} />
          </div>
        )}
      </div>
    </div>
  );
};

export default GameComponent;
