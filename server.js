class Server {
  async joinRoom(roomId) {
    if (roomId) {
      if (await $global.countRoomUsers(roomId) >= 8) throw Error('room is full');
    }

    // Generate a random room name in the format "Room-{randomNumber}" if no roomId is provided
    const defaultRoomId = `Room${Math.floor(Math.random() * 10000)}`;
    const joinedRoomId = await $global.joinRoom(roomId || defaultRoomId);

    // Initialize room state if not already set
    const roomState = await $room.getRoomState();
    if (!roomState?.obstacles) {
      await $room.updateRoomState({
        status: 'READY',
        obstacles: this.generateObstacles(40),
        gameTime: 0,
      });
    }

    // Initialize player data
    await $room.updateMyState({
      score: 0,
      health: 100,
      isRespawned: false,
      isDead: false
    });

    return joinedRoomId;
  }

  async leaveRoom() {
    try {
      // Before leaving, clean up player data by setting health to 0
      // This ensures the player appears dead/inactive in any UI lists
      await $room.updateMyState({
        health: 0,
        isDisconnected: true
      });
      
      // Now properly leave the room
      await $global.leaveRoom();
      
      return { success: true };
    } catch (error) {
      console.error("Error leaving game:", error);
      return { success: false };
    }
  }

  async setPlayerData(data) {
    await $room.updateMyState(data);
  }

  async updatePlayerPosition(data) {
    await $room.updateMyState(data);
  }

  async updatePlayerAnimation(data) {
    await $room.broadcastToRoom('playerAnimation', {
      playerId: $sender.account,
      ...data
    });
  }

  async playerAttack(data) {
    // Ã­Â¬Ã¬Â¬Ã¬Â²Â´ ÃªÂ³ÂµÃªÂ²Â© Ã­Ã¬ Ã¬Â²Ã«Â¦Â¬
    if (data.type === "projectile") {
      await $room.broadcastToRoom('projectileFired', data);
    } else {
      // Ã¬Â´Ã¬  Ã«Â°Â©Ã¬Ã¬ ÃªÂ³ÂµÃªÂ²Â© Ã¬Â²Ã«Â¦Â¬ Ã¬ Ã¬Â§ (Ã­Ã¬ Ã­Â¸Ã­Ã¬Â±)
      await $room.broadcastToRoom('playerAttack', data);
    }
  }

  async playerHit(data) {
    const { targetId, attackerId, damage, timestamp } = data;
    
    // Get current target health
    const targetState = await $room.getUserState(targetId);
    const currentHealth = targetState.health || 100;
    
    // Calculate new health
    const newHealth = Math.max(0, currentHealth - damage);
    
    // Update target health
    await $room.updateUserState(targetId, { 
      health: newHealth,
      // Ã«Â§Ã¬Â½ Ã¬Â²Â´Ã« Â¥Ã¬Â´ 0Ã¬Â´Ã«Â©Â´ isDead Ã­Ã«ÃªÂ·Â¸Ã«Â¥Â¼ Ã¬Â¤Ã¬ 
      isDead: newHealth <= 0 
    });
    
    // Broadcast hit to all players in room
    await $room.broadcastToRoom('playerHitSync', {
      targetId,
      attackerId,
      damage,
      newHealth,
      timestamp,
      // Ã¬Â²Â´Ã« Â¥Ã¬Â´ 0Ã¬Â´Ã«Â©Â´ Ã­Ã« Ã¬Â¤Ã­ Ã¬Â£Â½Ã¬ Ã¬Ã­ Ã¬ Ã­
      isDead: newHealth <= 0
    });
    
    // Check if player died (health reached 0)
    if (newHealth <= 0) {
      await this.playerDied({ playerId: targetId, killerId: attackerId });
    }
  }

  async playerDied(data) {
    const { playerId, killerId } = data;
    
    // Don't award points for suicide or environmental deaths
    if (killerId && killerId !== playerId) {
      // Get killer's current score
      const killerState = await $room.getUserState(killerId);
      const currentScore = killerState.score || 0;
      
      // Increment score by 1 for a kill
      await $room.updateUserState(killerId, { 
        score: currentScore + 1 
      });
    }
    
    // Mark player as dead in their state
    await $room.updateUserState(playerId, {
      isDead: true,
      health: 0
    });
    
    // Broadcast death event to all players
    await $room.broadcastToRoom('playerDied', {
      playerId,
      killerId
    });
  }

  async broadcastHitSync(data) {
    await $room.broadcastToRoom('playerHitSync', data);
  }

  async respawnPlayer(data) {
    const { x, y } = data;
    
    // Get current player state to preserve other properties
    const currentState = await $room.getMyState();
    
    // Create a complete player state with all necessary properties
    const completePlayerState = {
      x,
      y,
      health: 100,
      isDisconnected: false,
      isDead: false,
      isRespawned: true,
      respawnTime: Date.now(),
      animation: "idle",
      name: currentState.name,
      flipX: false,
      score: currentState.score || 0,
      lastUpdate: Date.now(),
      // Ã­Ã« Ã¬Â´Ã¬Â¸Ã­Â¸Ã¬ÃªÂ² deadPlayers Ã¬Â¸Ã­Â¸Ã¬Ã¬ Ã¬ ÃªÂ±Â°Ã­Ã«Â¼ÃªÂ³  Ã¬ Ã­Â¸ Ã«Â³Â´Ã«Â´ÃªÂ¸Â°
      forceRemoveFromDeadPlayers: true
    };
    
    // Update player state with complete data
    await $room.updateMyState(completePlayerState);
    
    // Ã«Â¦Â¬Ã¬Â¤Ã­Â° Ã¬Â´Ã«Â²Â¤Ã­Â¸Ã¬ forceRemoveFromDeadPlayers Ã­Ã«ÃªÂ·Â¸ Ã¬Â¶ÃªÂ°
    await $room.broadcastToRoom('playerRespawned', {
      playerId: $sender.account,
      forceRemoveFromDeadPlayers: true,
      ...completePlayerState
    });
    
    // ÃªÂ°Ã¬  Ã¬Ã­ Ã¬Ã«Â°Ã¬Â´Ã­Â¸Ã¬Ã« Ã­Ã«ÃªÂ·Â¸ Ã¬Â¶ÃªÂ°
    const allUserStates = await $room.getAllUserStates();
    await $room.broadcastToRoom('forceStateUpdate', {
      states: allUserStates,
      respawnedPlayerId: $sender.account,
      forceRemoveFromDeadPlayers: true,
      timestamp: Date.now()
    });
    
    // Ã«Â¦Â¬Ã¬Â¤Ã­Â° Ã¬Ã«Â¦Â¼Ã« Ã¬Â¤Ã¬Â¼Ã¬Â¤Ã«Â§
    this.scheduleRespawnReminders($sender.account, completePlayerState);
  }
  
  // Ã«Â¦Â¬Ã¬Â¤Ã­Â° Ã¬Ã«Â¦Â¼ Ã­Â¨Ã¬ (Ã¬Â¤Ã«Â³Âµ Ã¬ Ã¬ Ã¬ ÃªÂ±Â°)
  async scheduleRespawnReminders(playerId, playerState) {
    // Ã¬Â²Â« Ã«Â²Ã¬Â§Â¸ Ã¬Ã«Â¦Â¼ (500ms)
    setTimeout(async () => {
      try {
        await $room.broadcastToRoom('playerRespawnReminder', {
          playerId,
          playerState,
          forceRemoveFromDeadPlayers: true,
          timestamp: Date.now(),
          sequence: 1
        });
      } catch (error) {
        console.error("Error sending respawn reminder 1:", error);
      }
    }, 500);
    
    // Ã« Ã«Â²Ã¬Â§Â¸ Ã¬Ã«Â¦Â¼ (1.5s)
    setTimeout(async () => {
      try {
        await $room.broadcastToRoom('playerRespawnReminder', {
          playerId,
          playerState,
          forceRemoveFromDeadPlayers: true,
          timestamp: Date.now(),
          sequence: 2
        });
      } catch (error) {
        console.error("Error sending respawn reminder 2:", error);
      }
    }, 1500);
    
    // Ã¬Â¸ Ã«Â²Ã¬Â§Â¸ Ã¬Ã«Â¦Â¼ (3s)
    setTimeout(async () => {
      try {
        await $room.broadcastToRoom('playerRespawnReminder', {
          playerId,
          playerState,
          forceRemoveFromDeadPlayers: true,
          timestamp: Date.now(),
          sequence: 3
        });
      } catch (error) {
        console.error("Error sending respawn reminder 3:", error);
      }
    }, 3000);
  }

  // Generate random obstacles (for initialization)
  generateObstacles(count) {
    const obstacles = [];
    const worldSize = 2000;
    const minDistance = 150; // Minimum distance between obstacles
    
    // Helper to check if a position is too close to existing obstacles
    const isTooClose = (x, y) => {
      return obstacles.some(obs => {
        const distance = Math.sqrt(
          Math.pow(obs.x - x, 2) + 
          Math.pow(obs.y - y, 2)
        );
        return distance < minDistance;
      });
    };
    
    // Generate obstacles in a grid pattern
    for (let i = 0; i < count; i++) {
      let x, y;
      let attempts = 0;
      
      // Try to find a valid position (not too close to other obstacles)
      do {
        x = Math.floor(Math.random() * (worldSize - 200)) + 100;
        y = Math.floor(Math.random() * (worldSize - 200)) + 100;
        attempts++;
      } while (isTooClose(x, y) && attempts < 20);
      
      if (attempts < 20) {
        obstacles.push({ x, y });
      }
    }
    
    return obstacles;
  }

  // Room tick function for regular updates
  $roomTick(deltaMS, roomId) {
    this.updateGameState(deltaMS, roomId);
    this.checkRespawnedPlayers(deltaMS, roomId);
  }
  
  // Update game state (time, etc.)
  async updateGameState(deltaMS, roomId) {
    const roomState = await $room.getRoomState(roomId);
    if (!roomState) return;
    
    // Update game time
    const gameTime = (roomState.gameTime || 0) + deltaMS;
    await $room.updateRoomState(roomId, { gameTime });
  }
  
  // Check for recently respawned players and ensure they're visible
  async checkRespawnedPlayers(deltaMS, roomId) {
    try {
      const allUserStates = await $room.getAllUserStates();
      
      // Find any players that have respawned recently
      const respawnedPlayers = allUserStates.filter(state => 
        state.isRespawned && 
        state.health > 0 && 
        state.respawnTime && 
        Date.now() - state.respawnTime < 15000 // Within last 15 seconds
      );
      
      // If we have respawned players, send a periodic reminder to all clients
      if (respawnedPlayers.length > 0) {
        // Only send periodic updates at certain intervals to avoid flooding
        const shouldSendUpdate = Date.now() % 3000 < deltaMS; // Every ~3 seconds
        
        if (shouldSendUpdate) {
          // Send a batch update with all respawned players
          await $room.broadcastToRoom('respawnedPlayersBatch', {
            players: respawnedPlayers.map(player => ({
              playerId: player.account,
              x: player.x,
              y: player.y,
              health: player.health,
              name: player.name,
              animation: player.animation || "idle",
              flipX: player.flipX || false,
              respawnTime: player.respawnTime,
              score: player.score || 0,
              forceRemoveFromDeadPlayers: true,
              timestamp: Date.now()
            })),
            timestamp: Date.now()
          });
          
          // Also send a full state update periodically
          await $room.broadcastToRoom('forceStateUpdate', {
            states: allUserStates,
            forceRemoveFromDeadPlayers: true,
            timestamp: Date.now()
          });
        }
        
        // Process individual players for cleanup
        for (const player of respawnedPlayers) {
          // After 15 seconds, clear the respawn flag
          if (player.respawnTime && Date.now() - player.respawnTime > 15000) {
            await $room.updateUserState(player.account, {
              isRespawned: false
            });
          }
        }
      }
    } catch (error) {
      console.error("Error checking respawned players:", error);
    }
  }
}
