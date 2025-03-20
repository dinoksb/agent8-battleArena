import React from "react";
import { useRoomState, useRoomAllUserStates } from "@agent8/gameserver";

interface GameUIProps {
  roomId: string;
  onExitGame: () => void;
}

const GameUI: React.FC<GameUIProps> = ({ roomId, onExitGame }) => {
  const roomState = useRoomState();
  const allPlayers = useRoomAllUserStates();
  
  // Sort players by score
  const sortedPlayers = [...(roomState?.$users || [])].map(account => {
    const playerData = allPlayers?.find(player => player.account === account) || { account, score: 0 };
    return playerData;
  }).sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <div className="flex justify-between items-center w-full text-white">
      {/* Room info */}
      <div className="flex space-x-4">
        <div className="bg-gray-900 bg-opacity-75 p-2 rounded-md">
          <p className="text-sm font-medium">Room: {roomId}</p>
        </div>
        <div className="bg-gray-900 bg-opacity-75 p-2 rounded-md">
          <p className="text-sm font-medium">Players: {roomState?.$users?.length || 0}/8</p>
        </div>
        {roomState?.gameTime && (
          <div className="bg-gray-900 bg-opacity-75 p-2 rounded-md">
            <p className="text-sm font-medium">Time: {Math.floor(roomState.gameTime / 1000)}s</p>
          </div>
        )}
      </div>

      {/* Scoreboard */}
      <div className="bg-gray-900 bg-opacity-75 p-2 rounded-md">
        <h3 className="text-sm font-bold mb-1">Scoreboard</h3>
        <div className="flex flex-wrap gap-2 max-w-md">
          {sortedPlayers.map((player, index) => (
            <div 
              key={player.account} 
              className="flex justify-between text-xs bg-gray-800 px-2 py-1 rounded"
            >
              <span>{index + 1}. {player.name || player.account.substring(0, 6)}</span>
              <span className="ml-2 font-bold">{player.score || 0}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Exit button */}
      <button
        onClick={onExitGame}
        className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded-md text-sm font-medium transition-colors"
      >
        Exit
      </button>
    </div>
  );
};

export default GameUI;
