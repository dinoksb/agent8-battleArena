class Server {
	test(){}
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
      isDead: false,
      lastDeathTime: 0,
      isDisconnected: false // ëªìì ì¼ë¡ ì°ê²° ìí ì¤ì 
    });

    return joinedRoomId;
  }

  async leaveRoom() {
    try {
      // ë°©ì ë ëê¸° ì ì ì´ íë ì´ì´ê° ë ëë¤ë ê²ì ëª¨ë  í´ë¼ì´ì¸í¸ìê² ìë¦¼
      await $room.broadcastToRoom('playerDisconnected', {
        playerId: $sender.account,
        timestamp: Date.now()
      });
      
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
    // íë¡ì í¸ ê³µê²© ì²ë¦¬
    if (data.type === "projectile") {
      await $room.broadcastToRoom('projectileFired', data);
    } else {
      // ì¼ë° ê³µê²©ì´ë ë¤ë¥¸ ì¢ë¥ì ê³µê²© ì²ë¦¬ (íì¥ í¬ì¸í¸)
      await $room.broadcastToRoom('playerAttack', data);
    }
  }

  // ìë¡ì´ ë©ìë: ì´ì ì ê±° ì´ë²¤í¸ë¥¼ ëª¨ë  í´ë¼ì´ì¸í¸ì ë¸ë¡ëìºì¤í¸
  async projectileDestroyed(data) {
    // ë°© ë´ ëª¨ë  í´ë¼ì´ì¸í¸ìê² ì´ì ì ê±° ì´ë²¤í¸ ë¸ë¡ëìºì¤í¸
    await $room.broadcastToRoom('projectileDestroyed', data);
  }

  async playerHit(data) {
    const { targetId, attackerId, projectileId, damage, timestamp } = data;
    
    // Get current target health
    const targetState = await $room.getUserState(targetId);
    const currentHealth = targetState.health || 100;
    
    // Calculate new health
    const newHealth = Math.max(0, currentHealth - damage);
    
    // Skip processing if the player is already dead or has just respawned recently
    const lastDeathTime = targetState.lastDeathTime || 0;
    const now = Date.now();
    if (targetState.isDead && now - lastDeathTime < 3000) {
      console.log(`Ignoring hit for recently dead player ${targetId}`);
      return;
    }
    
    // Update target health
    const isDead = newHealth <= 0;
    await $room.updateUserState(targetId, { 
      health: newHealth,
      isDead: isDead,
      lastDeathTime: isDead ? now : targetState.lastDeathTime
    });
    
    // Broadcast hit to all players in room
    await $room.broadcastToRoom('playerHitSync', {
      targetId,
      attackerId,
      damage,
      newHealth,
      timestamp,
      isDead: isDead,
      projectileId  // ì¶ê°: ì´ì IDë¥¼ í¬í¨íì¬ í´ë¼ì´ì¸í¸ê° í´ë¹ ì´ìì ì ê±°í  ì ìëë¡ í¨
    });
    
    // Check if player died (health reached 0)
    if (newHealth <= 0 && !targetState.isDead) {
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
      
      console.log(`Incremented score for player ${killerId} to ${currentScore + 1}`);
    }
    
    // Mark player as dead in their state with timestamp
    await $room.updateUserState(playerId, {
      isDead: true,
      health: 0,
      lastDeathTime: Date.now()
    });
    
    // Broadcast death event to all players
    await $room.broadcastToRoom('playerDied', {
      playerId,
      killerId,
      timestamp: Date.now()
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
      forceRemoveFromDeadPlayers: true
    };
    
    // Update player state with complete data
    await $room.updateMyState(completePlayerState);
    
    // ë¤ë¥¸ íë ì´ì´ìê² ë¶ííìì ìë¦¼
    await $room.broadcastToRoom('playerRespawned', {
      playerId: $sender.account,
      forceRemoveFromDeadPlayers: true,
      ...completePlayerState
    });
    
    // ê°ì  ìí ìë°ì´í¸ë¥¼ íµí´ ëê¸°í
    const allUserStates = await $room.getAllUserStates();
    await $room.broadcastToRoom('forceStateUpdate', {
      states: allUserStates,
      respawnedPlayerId: $sender.account,
      forceRemoveFromDeadPlayers: true,
      timestamp: Date.now()
    });
    
    // ë¤ë¥¸ íë ì´ì´ë¤ìê² ì£¼ê¸°ì ì¼ë¡ ìë¦¼
    this.scheduleRespawnReminders($sender.account, completePlayerState);
  }
  
  // íë ì´ì´ ì°ê²° ëê¹ íì¸ ë©ìë ì¶ê°
  async checkDisconnectedPlayers(deltaMS, roomId) {
    try {
      // ëª¨ë  ì ì  ìí ê°ì ¸ì¤ê¸°
      const allUserStates = await $room.getAllUserStates();
      
      // ë°©ì íì¬ ì°ê²°ë ì ì  ëª©ë¡ ê°ì ¸ì¤ê¸°
      const roomUsers = await $room.getRoomUserAccounts(roomId);
      const connectedUsers = new Set(roomUsers);
      
      // ìíë ìì§ë§ ì¤ì  ë°©ì ì°ê²°ëì´ ìì§ ìì ì ì  ì°¾ê¸°
      for (const state of allUserStates) {
        const account = state.account;
        
        // ìíë ìì§ë§ ì¤ì  ë°©ì ìë ê²½ì°
        if (account && !connectedUsers.has(account) && !state.isDisconnected) {
          console.log(`Found disconnected player ${account} that wasn't properly marked`);
          
          // ì°ê²° ëê¹ ìíë¡ ì¤ì 
          await $room.updateUserState(account, {
            isDisconnected: true,
            health: 0
          });
          
          // ëª¨ë  í´ë¼ì´ì¸í¸ìê² ìë¦¼
          await $room.broadcastToRoom('playerDisconnected', {
            playerId: account,
            timestamp: Date.now()
          });
        }
      }
    } catch (error) {
      console.error("Error checking disconnected players:", error);
    }
  }
  
  // ë¶íí íë ì´ì´ ìë¦¼ í¨ì (í´ë¼ì´ì¸í¸ ì±í¬ ë¬¸ì  í´ê²°)
  async scheduleRespawnReminders(playerId, playerState) {
    // ì²«ë²ì§¸ ìë¦¼ (500ms)
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
    
    // ëë²ì§¸ ìë¦¼ (1.5s)
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
    
    // ì¸ë²ì§¸ ìë¦¼ (3s)
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
    
    // ì£¼ê¸°ì ì¼ë¡ ì°ê²° ëê¸´ íë ì´ì´ íì¸ (10ì´ë§ë¤)
    if (Date.now() % 10000 < deltaMS) {
      this.checkDisconnectedPlayers(deltaMS, roomId);
    }
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
