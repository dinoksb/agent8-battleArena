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
      isDead: false,
      lastDeathTime: 0,
      isDisconnected: false // 명시적으로 연결 상태 설정
    });

    return joinedRoomId;
  }

  async leaveRoom() {
    try {
      // 방을 떠나기 전에 이 플레이어가 떠난다는 것을 모든 클라이언트에게 알림
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
    // 프로젝트 공격 처리
    if (data.type === "projectile") {
      await $room.broadcastToRoom('projectileFired', data);
    } else {
      // 일반 공격이나 다른 종류의 공격 처리 (확장 포인트)
      await $room.broadcastToRoom('playerAttack', data);
    }
  }

  // 새로운 메서드: 총알 제거 이벤트를 모든 클라이언트에 브로드캐스트
  async projectileDestroyed(data) {
    // 방 내 모든 클라이언트에게 총알 제거 이벤트 브로드캐스트
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
      projectileId  // 추가: 총알 ID를 포함하여 클라이언트가 해당 총알을 제거할 수 있도록 함
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
    
    // 다른 플레이어에게 부활했음을 알림
    await $room.broadcastToRoom('playerRespawned', {
      playerId: $sender.account,
      forceRemoveFromDeadPlayers: true,
      ...completePlayerState
    });
    
    // 강제 상태 업데이트를 통해 동기화
    const allUserStates = await $room.getAllUserStates();
    await $room.broadcastToRoom('forceStateUpdate', {
      states: allUserStates,
      respawnedPlayerId: $sender.account,
      forceRemoveFromDeadPlayers: true,
      timestamp: Date.now()
    });
    
    // 다른 플레이어들에게 주기적으로 알림
    this.scheduleRespawnReminders($sender.account, completePlayerState);
  }
  
  // 플레이어 연결 끊김 확인 메서드 추가
  async checkDisconnectedPlayers(deltaMS, roomId) {
    try {
      // 모든 유저 상태 가져오기
      const allUserStates = await $room.getAllUserStates();
      
      // 방의 현재 연결된 유저 목록 가져오기
      const roomUsers = await $room.getRoomUserAccounts(roomId);
      const connectedUsers = new Set(roomUsers);
      
      // 상태는 있지만 실제 방에 연결되어 있지 않은 유저 찾기
      for (const state of allUserStates) {
        const account = state.account;
        
        // 상태는 있지만 실제 방에 없는 경우
        if (account && !connectedUsers.has(account) && !state.isDisconnected) {
          console.log(`Found disconnected player ${account} that wasn't properly marked`);
          
          // 연결 끊김 상태로 설정
          await $room.updateUserState(account, {
            isDisconnected: true,
            health: 0
          });
          
          // 모든 클라이언트에게 알림
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
  
  // 부활한 플레이어 알림 함수 (클라이언트 싱크 문제 해결)
  async scheduleRespawnReminders(playerId, playerState) {
    // 첫번째 알림 (500ms)
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
    
    // 두번째 알림 (1.5s)
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
    
    // 세번째 알림 (3s)
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
    
    // 주기적으로 연결 끊긴 플레이어 확인 (10초마다)
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
