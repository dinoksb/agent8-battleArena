import Phaser from "phaser";
import { Player } from "../entities/Player";
import { KnightConfig } from "../config/KnightConfig";

export class GameScene extends Phaser.Scene {
  // Game objects
  private player!: Player;
  private otherPlayers: Map<string, Player> = new Map();
  private projectiles: Map<string, Phaser.Physics.Arcade.Sprite> = new Map();
  
  // Map elements
  private map!: Phaser.Tilemaps.Tilemap;
  private obstacles!: Phaser.Physics.Arcade.StaticGroup;
  
  // Game data
  private playerName: string = "";
  private roomId: string = "";
  private server: any = null;
  private lastPositionUpdate: number = 0;
  private positionUpdateInterval: number = 50; // ms
  private myAccount: string = "";
  private serverInitialized: boolean = false;
  private assetsLoaded: boolean = false;
  private obstaclesCreated: boolean = false;
  private lastGameTime: number = 0;
  
  // Player color tracking
  private usedColorIndices: Set<number> = new Set();
  
  // Input handling
  private spaceKey: Phaser.Input.Keyboard.Key | null = null;
  private attackCooldown: boolean = false;
  
  // Track damaged players and their health
  private damagedPlayers: Map<string, number> = new Map();
  // Track when damage was applied to prevent race conditions
  private damageTimestamps: Map<string, number> = new Map();
  
  // Track player animation states
  private playerAnimations: Map<string, string> = new Map();
  
  // Track dead players to prevent auto-respawn
  private deadPlayers: Set<string> = new Set();
  
  // ì´ì ì ê±° ìì²­ ì¶ì ì ìí ë³ì ì¶ê°
  private projectileDestroyRequests: Set<string> = new Set();
  
  // ì°ê²° ëê¸´ íë ì´ì´ ì¶ì 
  private disconnectedPlayers: Set<string> = new Set();
  
  constructor() {
    super({ key: "GameScene" });
  }

  setGameData(data: { playerName: string; roomId: string; server: any }) {
    this.playerName = data.playerName;
    this.roomId = data.roomId;
    this.server = data.server;
    
    if (this.server && this.server.account) {
      this.myAccount = this.server.account;
      this.serverInitialized = true;
      
      // Set up subscriptions after server is initialized
      if (this.scene.isActive()) {
        this.setupServerSubscriptions();
        
        // Send initial player data
        this.updatePlayerOnServer();
      }
    }
  }

  preload() {
    // Load game assets
    this.load.spritesheet("knight", KnightConfig.spriteSheet, {
      frameWidth: KnightConfig.frameWidth,
      frameHeight: KnightConfig.frameHeight
    });
    this.load.image("projectile", "https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/bullets/bullet7.png");
    this.load.image("obstacle", "https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/sprites/block.png");
    this.load.image("background", "https://raw.githubusercontent.com/photonstorm/phaser3-examples/master/public/assets/skies/space3.png");
    
    // í¬ëªí íì¤ì² ë¡ë (ê²½ê³ì ì©)
    this.load.image("invisibleWall", "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAYAAAAeP4ixAAAAEklEQVR42mNgGAWjYBSMglEwCgYAAAi4AAE4hYMOAAAAAElFTkSuQmCC");
  }

  create() {
    // Create background
    this.add.tileSprite(0, 0, 2000, 2000, "background").setOrigin(0, 0);
    
    // Create game world bounds
    this.physics.world.setBounds(0, 0, 2000, 2000);
    
    // Initialize obstacles - will be created after receiving server data
    this.obstacles = this.physics.add.staticGroup();
    
    // Create knight animations
    this.createKnightAnimations();
    
    // Create player
    this.player = new Player(
      this,
      Phaser.Math.Between(100, 1900),
      Phaser.Math.Between(100, 1900),
      "knight",
      this.playerName,
      this.myAccount
    );
    
    // Setup camera to follow player
    this.cameras.main.setBounds(0, 0, 2000, 2000);
    this.cameras.main.startFollow(this.player.sprite, true, 0.09, 0.09);
    this.cameras.main.setZoom(1);
    
    // Setup input
    this.setupInput();
    
    // Set up server subscriptions if server is already initialized
    if (this.serverInitialized) {
      this.setupServerSubscriptions();
      
      // Send initial player data
      this.updatePlayerOnServer();
    }
    
    // Mark assets as loaded
    this.assetsLoaded = true;
  }

  private createKnightAnimations() {
    const { animations } = KnightConfig;
    
    // Create idle animation
    this.anims.create({
      key: animations.idle.key,
      frames: this.anims.generateFrameNumbers("knight", {
        start: animations.idle.frames.start,
        end: animations.idle.frames.end
      }),
      frameRate: animations.idle.frameRate,
      repeat: animations.idle.repeat
    });
    
    // Create walk animation
    this.anims.create({
      key: animations.walk.key,
      frames: this.anims.generateFrameNumbers("knight", {
        start: animations.walk.frames.start,
        end: animations.walk.frames.end
      }),
      frameRate: animations.walk.frameRate,
      repeat: animations.walk.repeat
    });
    
    // Create attack animation
    this.anims.create({
      key: animations.attack.key,
      frames: this.anims.generateFrameNumbers("knight", {
        start: animations.attack.frames.start,
        end: animations.attack.frames.end
      }),
      frameRate: animations.attack.frameRate,
      repeat: animations.attack.repeat
    });
  }

  private setupServerSubscriptions() {
    if (!this.server || !this.roomId) return;
    
    // Subscribe to projectile creation events
    this.server.onRoomMessage(this.roomId, "projectileFired", this.handleProjectileFired.bind(this));
    
    // ì´ì ì ê±° ì´ë²¤í¸ êµ¬ë ì¶ê°
    this.server.onRoomMessage(this.roomId, "projectileDestroyed", this.handleProjectileDestroyed.bind(this));
    
    // íë ì´ì´ ì°ê²° ëê¹ ì´ë²¤í¸ êµ¬ë ì¶ê°
    this.server.onRoomMessage(this.roomId, "playerDisconnected", this.handlePlayerDisconnected.bind(this));
    
    // Subscribe to room state for obstacles
    this.server.subscribeRoomState(this.roomId, (state: any) => {
      if (state && state.obstacles && !this.obstaclesCreated) {
        this.createObstaclesFromServer(state.obstacles);
      }
      
      // Update game time if it has changed
      if (state && state.gameTime !== undefined && state.gameTime !== this.lastGameTime) {
        this.lastGameTime = state.gameTime;
        this.events.emit("updateGameTime", state.gameTime);
      }
    });
    
    // Subscribe to player hit events to ensure health sync
    this.server.onRoomMessage(this.roomId, "playerHitSync", this.handlePlayerHitSync.bind(this));
    
    // Subscribe to player animation events
    this.server.onRoomMessage(this.roomId, "playerAnimation", this.handlePlayerAnimation.bind(this));
    
    // Subscribe to player attack events
    this.server.onRoomMessage(this.roomId, "playerAttack", this.handlePlayerAttack.bind(this));
    
    // Subscribe to player respawn events
    this.server.onRoomMessage(this.roomId, "playerRespawned", this.handlePlayerRespawned.bind(this));
    
    // Subscribe to respawn reminder events
    this.server.onRoomMessage(this.roomId, "playerRespawnReminder", this.handlePlayerRespawnReminder.bind(this));
    
    // Subscribe to force state update events
    this.server.onRoomMessage(this.roomId, "forceStateUpdate", this.handleForceStateUpdate.bind(this));
    
    // Subscribe to all room user states for player synchronization
    this.server.subscribeRoomAllUserStates(this.roomId, (states: any[]) => {
      if (states && Array.isArray(states)) {
        this.updatePlayerStates(states);
      }
    });
    
    // ì ì  í´ì¥ ì´ë²¤í¸ êµ¬ë
    this.server.onRoomUserLeave(this.roomId, (account: string) => {
      // ì ì ê° ë°©ì ë ëë©´ í´ë¹ íë ì´ì´ë¥¼ ì°ê²° ëê¹ ì²ë¦¬
      console.log(`Player left room: ${account}`);
      this.handlePlayerDisconnected({ playerId: account, timestamp: Date.now() });
    });

    // ì£¼ì: íë ì´ì´    // ì£¼ì: íë ì´ì´ ì¬ë§ ì´ë²¤í¸ êµ¬ë
    this.server.onRoomMessage(this.roomId, "playerDied", (data: any) => {
      const { playerId } = data;
      
      // ë§ì½ ìì ì´ ì¬ë§í íë ì´ì´ë¼ë©´
      if (playerId === this.myAccount) {
        // ìì ì ì¬ë§ì ìë¦¼, UI ë¸ì¶
        window.dispatchEvent(new CustomEvent('player-died'));
        
        // deadPlayers ë¦¬ì¤í¸ì ì¶ê°
        this.deadPlayers.add(playerId);
      } else if (this.otherPlayers.has(playerId)) {
        // ë¤ë¥¸ íë ì´ì´ê° ì£½ìì ë deadPlayers ë¦¬ì¤í¸ì ì¶ê°
        this.deadPlayers.add(playerId);
        
        // ë¤ë¥¸ íë ì´ì´ì ìí ìë°ì´í¸ (ë¹íì±í)
        const player = this.otherPlayers.get(playerId);
        if (player) {
          player.setHealth(0);
        }
      }
    });
  }
  
  // íë ì´ì´ ì°ê²° ëê¹ í¸ë¤ë¬ ì¶ê°
  private handlePlayerDisconnected(data: any) {
    const { playerId, timestamp } = data;
    
    console.log(`Player disconnected: ${playerId}`);
    
    // ì°ê²° ëê¸´ íë ì´ì´ ëª©ë¡ì ì¶ê°
    this.disconnectedPlayers.add(playerId);
    
    // í´ë¹ íë ì´ì´ ê°ì²´ê° ì¡´ì¬íë©´ ì ê±°
    if (this.otherPlayers.has(playerId)) {
      const player = this.otherPlayers.get(playerId);
      
      // íë ì´ì´ ìºë¦­í° ê°ì²´ ì ê±°
      if (player) {
        player.destroy();
      }
      
      // ë¤ë¥¸ ë°ì´í° êµ¬ì¡°ììë íë ì´ì´ ì ë³´ ì ê±°
      this.otherPlayers.delete(playerId);
      this.damagedPlayers.delete(playerId);
      this.damageTimestamps.delete(playerId);
      this.playerAnimations.delete(playerId);
      this.deadPlayers.delete(playerId);
      
      // ìì ì¸ë±ì¤ í´ì 
      const colorIndex = this.hashCode(playerId) % 8 + 1;
      this.usedColorIndices.delete(colorIndex);
      
      console.log(`Removed disconnected player: ${playerId}`);
    }
  }

  update(time: number, delta: number) {
    // Update player
    if (this.player) {
      this.player.update();
      
      // Send position updates at fixed intervals
      if (this.serverInitialized && time - this.lastPositionUpdate > this.positionUpdateInterval) {
        this.updatePlayerOnServer();
        this.lastPositionUpdate = time;
      }
      
      // Check for spacebar attack
      if (this.spaceKey && Phaser.Input.Keyboard.JustDown(this.spaceKey) && !this.attackCooldown) {
        this.handleSpacebarAttack();
      }
    }
    
    // Update other players
    this.otherPlayers.forEach(player => player.update());
    
    // Update projectiles
    this.projectiles.forEach((projectile, id) => {
      // ì´ë¯¸ ì ê±° ìì²­ì´ ìë ì´ìì ì²ë¦¬íì§ ìì
      if (this.projectileDestroyRequests.has(id)) {
        return;
      }
      
      // Check for projectile collisions with players
      if (this.player && projectile.getData("ownerId") !== this.myAccount && !this.player.isDead()) {
        if (this.physics.overlap(projectile, this.player.sprite)) {
          this.handlePlayerHit(this.myAccount, projectile.getData("ownerId"), id);
          // ì´ì ì ê±° ìì²­ ëª©ë¡ì ì¶ê°
          this.destroyProjectile(id, true);
          return;
        }
      }
      
      // Check for projectile collisions with other players
      this.otherPlayers.forEach((otherPlayer, playerId) => {
        if (projectile.getData("ownerId") === this.myAccount && !otherPlayer.isDead()) {
          if (this.physics.overlap(projectile, otherPlayer.sprite)) {
            this.handlePlayerHit(playerId, this.myAccount, id);
            // ì´ì ì ê±° ìì²­ ëª©ë¡ì ì¶ê°
            this.destroyProjectile(id, true);
            return;
          }
        }
      });
      
      // Check for projectile collisions with obstacles
      if (this.physics.overlap(projectile, this.obstacles)) {
        // ì´ìì´ ì¥ì ë¬¼ê³¼ ì¶©ëí ê²½ì°ìë ëª¨ë  í´ë¼ì´ì¸í¸ì ìë¦¼
        this.destroyProjectile(id, true);
        return;
      }
      
      // Remove projectiles that have exceeded their lifetime
      const creationTime = projectile.getData("creationTime");
      if (Date.now() - creationTime > 2000) { // 2 seconds lifetime
        // ìëªì´ ë¤í ì´ìë ëª¨ë  í´ë¼ì´ì¸í¸ì ìë¦¼
        this.destroyProjectile(id, true);
      }
    });
  }

  // ì´ì ì ê±° ë©ìë - ë¤í¸ìí¬ ëê¸°í í¬í¨
  private destroyProjectile(projectileId: string, notifyServer: boolean = false) {
    // ì´ë¯¸ ì ê±° ìì²­ë ì´ìì´ë©´ ë¬´ì
    if (this.projectileDestroyRequests.has(projectileId)) {
      return;
    }
    
    // ì´ì ì ê±° ìì²­ ëª©ë¡ì ì¶ê°
    this.projectileDestroyRequests.add(projectileId);
    
    // ì¤ì  ì´ì ê°ì²´ ê°ì ¸ì¤ê¸°
    const projectile = this.projectiles.get(projectileId);
    if (projectile) {
      // ìê°ì  í¨ê³¼ (íí°í´ ë±)
      this.addProjectileDestroyEffect(projectile.x, projectile.y);
      
      // ì´ì ê°ì²´ ì ê±°
      projectile.destroy();
      this.projectiles.delete(projectileId);
      
      // ìë²ì ìë¦¼ (íìí ê²½ì°)
      if (notifyServer && this.serverInitialized) {
        this.server.remoteFunction("projectileDestroyed", [{
          projectileId: projectileId,
          x: projectile.x,
          y: projectile.y,
          timestamp: Date.now()
        }]);
      }
    }
    
    // ì½ê°ì ì§ì° í ì ê±° ìì²­ ëª©ë¡ìì ì ê±° (ë©ëª¨ë¦¬ ê´ë¦¬)
    setTimeout(() => {
      this.projectileDestroyRequests.delete(projectileId);
    }, 5000);
  }
  
  // ì´ì ì ê±° ì ìê°ì  í¨ê³¼ ì¶ê°
  private addProjectileDestroyEffect(x: number, y: number) {
    // ê°ë¨í íí°í´ í¨ê³¼
    const particles = this.add.particles(x, y, 'projectile', {
      speed: { min: 50, max: 100 },
      scale: { start: 0.4, end: 0 },
      lifespan: 300,
      blendMode: 'ADD',
      quantity: 8
    });
    
    // ì ì í íí°í´ ì ê±°
    this.time.delayedCall(300, () => {
      particles.destroy();
    });
  }

  // Create obstacles from server data
  private createObstaclesFromServer(obstacleData: any[]) {
    try {
      if (!this.assetsLoaded || this.obstaclesCreated) return;
      
      console.log("Creating obstacles from server data:", obstacleData);
      
      // Clear existing obstacles
      this.obstacles.clear(true, true);
      
      // Create border obstacles (fixed positions)
      this.createBorderObstacles();
      
      // Create obstacles from server data
      if (Array.isArray(obstacleData)) {
        obstacleData.forEach(data => {
          if (data && data.x !== undefined && data.y !== undefined) {
            const obstacle = this.obstacles.create(data.x, data.y, "obstacle");
            // obstacleì ê·¸ëë¡ íì
            obstacle.refreshBody();
          }
        });
      }
      
      // Set up collision between player and obstacles
      this.physics.add.collider(this.player.sprite, this.obstacles);
      
      // Set up collision between other players and obstacles
      this.otherPlayers.forEach(player => {
        this.physics.add.collider(player.sprite, this.obstacles);
      });
      
      this.obstaclesCreated = true;
    } catch (error) {
      console.error("Error creating obstacles from server:", error);
    }
  }

  // Create border obstacles (identical on all clients)
  private createBorderObstacles() {
    // íëë¦¬ ì¥ì ë¬¼ ìì± - ì´ì  ë³´ì´ì§ ìë ë²½ì ì¬ì©
    for (let i = 0; i < 2000; i += 50) {
      // ìë¨ ë²½
      const topWall = this.obstacles.create(i, 0, "invisibleWall");
      topWall.setVisible(false); // ìê°ì ì¼ë¡ ë³´ì´ì§ ìê² ì¤ì 
      topWall.refreshBody();
      
      // íë¨ ë²½
      const bottomWall = this.obstacles.create(i, 2000, "invisibleWall");
      bottomWall.setVisible(false);
      bottomWall.refreshBody();
      
      // ì¼ìª½ ë²½
      const leftWall = this.obstacles.create(0, i, "invisibleWall");
      leftWall.setVisible(false);
      leftWall.refreshBody();
      
      // ì¤ë¥¸ìª½ ë²½
      const rightWall = this.obstacles.create(2000, i, "invisibleWall");
      rightWall.setVisible(false);
      rightWall.refreshBody();
    }
    
    // íëë¦¬ êµ¬ë¶ì ìí ìì ì (ì íì¬í­)
    const graphics = this.add.graphics();
    graphics.lineStyle(2, 0x00ff00, 0.3); // ìê³  í¬ëªí ì´ë¡ì ì 
    graphics.strokeRect(0, 0, 2000, 2000);
  }

  private setupInput() {
    // Set up spacebar for attacks
    this.spaceKey = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
  }
  
  private handleSpacebarAttack() {
    if (!this.player || !this.serverInitialized || this.player.isDead()) return;
    
    // Set attack cooldown
    this.attackCooldown = true;
    
    // Play attack animation
    this.player.playAttackAnimation();
    
    // Get player position and direction
    const playerSprite = this.player.sprite;
    const direction = playerSprite.flipX ? -1 : 1;
    
    // Calculate target position based on player direction (left/right)
    const targetX = playerSprite.flipX ? 
      playerSprite.x - 1000 : // Left direction
      playerSprite.x + 1000;  // Right direction
    const targetY = playerSprite.y; // Keep same Y position for straight line
    
    // Create a unique ID for this projectile
    const projectileId = `projectile_${this.myAccount}_${Date.now()}`;
    
    // Create projectile on this client
    this.createProjectile({
      id: projectileId,
      x: playerSprite.x,
      y: playerSprite.y - 10, // Adjust y position to fire from slightly above center
      targetX: targetX,
      targetY: targetY,
      ownerId: this.myAccount
    });
    
    // Send projectile data to server for synchronization
    this.server.remoteFunction("playerAttack", [
      {
        type: "projectile",
        id: projectileId,
        x: playerSprite.x,
        y: playerSprite.y - 10,
        targetX: targetX,
        targetY: targetY,
        direction: direction,
        ownerId: this.myAccount,
        ownerName: this.playerName
      }
    ]);
    
    // Reset cooldown after a short delay
    this.time.delayedCall(500, () => {
      this.attackCooldown = false;
    });
  }

  private handleProjectileFired(data: any) {
    // Check if necessary objects are initialized before creating projectile
    if (!this.scene.isActive() || !this.physics) {
      console.warn("Scene not active or physics not initialized when handling projectile");
      return;
    }
    
    // Don't create projectiles fired by this player (already created locally)
    if (data.ownerId === this.myAccount) return;
    
    // ì°ê²° ëê¸´ íë ì´ì´ì ì´ìì ìì±íì§ ìì
    if (this.disconnectedPlayers.has(data.ownerId)) {
      console.log(`Ignoring projectile from disconnected player: ${data.ownerId}`);
      return;
    }
    
    try {
      this.createProjectile(data);
    } catch (error) {
      console.error("Error creating projectile:", error);
    }
  }
  
  // ì´ì ì ê±° ì´ë²¤í¸ í¸ë¤ë¬ ì¶ê°
  private handleProjectileDestroyed(data: any) {
    const { projectileId } = data;
    
    // ìì ì´ ë°ì¬í ì´ìì¸ ê²½ì°ìë ì´ë¯¸ ì ê±°íì ì ìì¼ë¯ë¡ íì¸
    if (this.projectileDestroyRequests.has(projectileId)) {
      return;
    }
    
    // ë¤ë¥¸ í´ë¼ì´ì¸í¸ìì íê´´ë ì´ìì ì´ í´ë¼ì´ì¸í¸ììë íê´´
    this.destroyProjectile(projectileId, false);
    
    // ë¡ê·¸ ì¶ë ¥ (ëë²ê¹ì©)
    console.log(`Projectile destroyed by network event: ${projectileId}`);
  }
  
  private createProjectile(data: any) {
    const { x, y, targetX, targetY, id, ownerId } = data;
    
    // ì´ë¯¸ ì ê±° ìì²­ë ì´ìì´ë©´ ìì±íì§ ìì
    if (this.projectileDestroyRequests.has(id)) {
      return null;
    }
    
    // ì°ê²° ëê¸´ íë ì´ì´ì ì´ìì ìì±íì§ ìì
    if (this.disconnectedPlayers.has(ownerId)) {
      console.log(`Not creating projectile from disconnected player: ${ownerId}`);
      return null;
    }
    
    // Create sprite
    const projectile = this.physics.add.sprite(x, y, "projectile");
    projectile.setScale(0.5);
    projectile.setData("id", id);
    projectile.setData("ownerId", ownerId);
    projectile.setData("creationTime", Date.now());
    
    // Calculate angle and velocity
    const angle = Phaser.Math.Angle.Between(x, y, targetX, targetY);
    projectile.setRotation(angle);
    
    // Set velocity based on angle
    const speed = 500;
    this.physics.velocityFromRotation(angle, speed, projectile.body.velocity);
    
    // Add visual trail effect using simple graphics instead of particles
    const trail = this.add.graphics();
    trail.fillStyle(0xffff00, 0.5);
    trail.fillCircle(x, y, 5);
    
    // Fade out and remove the trail after a short time
    this.tweens.add({
      targets: trail,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        trail.destroy();
      }
    });
    
    // Set depth to ensure projectile is above background
    projectile.setDepth(5);
    
    this.projectiles.set(id, projectile);
    
    // Add collisions with obstacles
    this.physics.add.collider(
      projectile,
      this.obstacles,
      () => {
        // ì¥ì ë¬¼ê³¼ ì¶©ë ì ì´ì ì ê±° ë° ìë²ì ìë¦¼
        this.destroyProjectile(id, true);
      },
      undefined,
      this
    );
    
    return projectile;
  }

  // Handle player hit sync message from server
  private handlePlayerHitSync(data: any) {
    const { targetId, attackerId, damage, newHealth, timestamp, forceRemoveFromDeadPlayers, isDead, projectileId } = data;
    
    // ì°ê²° ëê¸´ íë ì´ì´ì í¼ê²© ì´ë²¤í¸ë ë¬´ì
    if (this.disconnectedPlayers.has(targetId)) {
      console.log(`Ignoring hit sync for disconnected player: ${targetId}`);
      return;
    }
    
    // ë§ì½ projectileIdê° ì¡´ì¬íë©´ í´ë¹ ì´ì ì ê±°
    if (projectileId && this.projectiles.has(projectileId)) {
      this.destroyProjectile(projectileId, false);
    }
    
    // Check if we need to force remove from deadPlayers set
    if (forceRemoveFromDeadPlayers && targetId) {
      this.deadPlayers.delete(targetId);
      console.log(`Forced removal of player ${targetId} from deadPlayers set`);
    }
    
    // If this is about our player being hit
    if (targetId === this.myAccount) {
      console.log(`Received hit sync for local player. New health: ${newHealth}`);
      // Update our health to match server's value
      this.player.setHealth(newHealth);
      
      // ì¹´ë©ë¼ í¨ê³¼ë¡ í¼ê²© ëëì ê°í
      this.cameras.main.shake(100, 0.01);
      
      // Check if player died
      if (newHealth <= 0 || isDead) {
        // Dispatch custom event for player death
        window.dispatchEvent(new CustomEvent('player-died'));
        // Add to dead players set
        this.deadPlayers.add(targetId);
      }
    } 
    // If this is about another player being hit
    else if (this.otherPlayers.has(targetId)) {
      const targetPlayer = this.otherPlayers.get(targetId);
      if (targetPlayer) {
        console.log(`Received hit sync for player ${targetId}. New health: ${newHealth}`);
        
        // Get the timestamp of our last local damage to this player
        const lastDamageTime = this.damageTimestamps.get(targetId) || 0;
        
        // If the server message is newer than our last local damage, use the server value
        if (timestamp > lastDamageTime) {
          targetPlayer.setHealth(newHealth);
          // Update our local tracking
          this.damagedPlayers.set(targetId, newHealth);
          
          // If player died, add to dead players set
          if (newHealth <= 0 || isDead) {
            this.deadPlayers.add(targetId);
          }
        }
      }
    }
  }

  // Handle player animation message from server
  private handlePlayerAnimation(data: any) {
    const { playerId, animation, flipX, forceRemoveFromDeadPlayers } = data;
    
    // ì°ê²° ëê¸´ íë ì´ì´ì ì ëë©ì´ì ì´ë²¤í¸ë ë¬´ì
    if (this.disconnectedPlayers.has(playerId)) {
      return;
    }
    
    // Check if we need to force remove from deadPlayers set
    if (forceRemoveFromDeadPlayers && playerId) {
      this.deadPlayers.delete(playerId);
      console.log(`Forced removal of player ${playerId} from deadPlayers set`);
    }
    
    // Skip if this is about our own player (we handle our own animations)
    if (playerId === this.myAccount) return;
    
    // Find the player and update their animation
    if (this.otherPlayers.has(playerId)) {
      const player = this.otherPlayers.get(playerId)!;
      
      // Skip animation updates for dead players unless forceRemoveFromDeadPlayers is true
      if (player.isDead() && !forceRemoveFromDeadPlayers) return;
      
      // Update sprite flip
      if (flipX !== undefined) {
        player.sprite.setFlipX(flipX);
      }
      
      // Play the appropriate animation
      if (animation === "idle") {
        player.playIdleAnimation();
      } else if (animation === "walk") {
        player.playWalkAnimation();
      } else if (animation === "attack") {
        player.playAttackAnimation();
      }
      
      // Store the current animation
      this.playerAnimations.set(playerId, animation);
    }
  }
  
  // Handle player attack message from server
  private handlePlayerAttack(data: any) {
    // ì°ê²° ëê¸´ íë ì´ì´ì ê³µê²© ì´ë²¤í¸ë ë¬´ì
    if (this.disconnectedPlayers.has(data.ownerId)) {
      return;
    }
    
    // Check for type field - if it's a projectile, handle it differently
    if (data.type === "projectile") {
      this.handleProjectileFired(data);
      return;
    }
    
    const { ownerId, x, y, direction, forceRemoveFromDeadPlayers } = data;
    
    // Check if we need to force remove from deadPlayers set
    if (forceRemoveFromDeadPlayers && ownerId) {
      this.deadPlayers.delete(ownerId);
      console.log(`Forced removal of player ${ownerId} from deadPlayers set`);
    }
    
    // Skip if this is our own attack (we already handled it locally)
    if (ownerId === this.myAccount) return;
    
    // Find the player and play attack animation
    if (this.otherPlayers.has(ownerId)) {
      const player = this.otherPlayers.get(ownerId)!;
      
      // Skip attack animation for dead players unless forceRemoveFromDeadPlayers is true
      if (player.isDead() && !forceRemoveFromDeadPlayers) return;
      
      // Update player position if needed
      if (x !== undefined && y !== undefined) {
        player.moveTo(x, y);
      }
      
      // Set sprite flip based on attack direction
      if (direction !== undefined) {
        player.sprite.setFlipX(direction < 0);
      }
      
      // Play attack animation
      player.playAttackAnimation();
    }
  }

  // Handle player respawn event
  private handlePlayerRespawned(data: any) {
    const { playerId, x, y, health, forceRemoveFromDeadPlayers } = data;
    
    // ì°ê²° ëê¸´ íë ì´ì´ì ë¶í ì´ë²¤í¸ë ë¬´ì
    if (this.disconnectedPlayers.has(playerId)) {
      return;
    }
    
    console.log(`Player respawned: ${playerId}, forceRemoveFromDeadPlayers: ${forceRemoveFromDeadPlayers}`);
    
    // ìì ì ë¶íì ë¡ì»¬ìì ì²ë¦¬íë¯ë¡ ë¬´ì
    if (playerId === this.myAccount) return;
    
    // Force remove from deadPlayers set if flag is present
    if (forceRemoveFromDeadPlayers) {
      this.deadPlayers.delete(playerId);
      console.log(`Removed player ${playerId} from deadPlayers set due to respawn`);
    }
    
    // Update player if it exists
    if (this.otherPlayers.has(playerId)) {
      const player = this.otherPlayers.get(playerId)!;
      
      // Update position
      if (x !== undefined && y !== undefined) {
        player.sprite.setPosition(x, y);
      }
      
      // Update health
      if (health !== undefined) {
        player.setHealth(health);
      }
      
      // Reset player state
      player.reset();
      
      // Play idle animation
      player.playIdleAnimation();
    }
  }
  
  // Handle player respawn reminder event
  private handlePlayerRespawnReminder(data: any) {
    const { playerId, playerState, forceRemoveFromDeadPlayers } = data;
    
    // ì°ê²° ëê¸´ íë ì´ì´ì ë¶í ìë¦¼ ì´ë²¤í¸ë ë¬´ì
    if (this.disconnectedPlayers.has(playerId)) {
      return;
    }
    
    console.log(`Respawn reminder for player: ${playerId}, forceRemoveFromDeadPlayers: ${forceRemoveFromDeadPlayers}`);
    
    // Force remove from deadPlayers set if flag is present
    if (forceRemoveFromDeadPlayers) {
      this.deadPlayers.delete(playerId);
      console.log(`Removed player ${playerId} from deadPlayers set due to respawn reminder`);
    }
    
    // If this is about our own player, we already handled it
    if (playerId === this.myAccount) return;
    
    // Update player if it exists
    if (this.otherPlayers.has(playerId) && playerState) {
      const player = this.otherPlayers.get(playerId)!;
      
      // Update position
      if (playerState.x !== undefined && playerState.y !== undefined) {
        player.sprite.setPosition(playerState.x, playerState.y);
      }
      
      // Update health
      if (playerState.health !== undefined) {
        player.setHealth(playerState.health);
      }
      
      // Reset player state if they were dead
      if (player.isDead() && playerState.health > 0) {
        player.reset();
      }
      
      // Play idle animation
      player.playIdleAnimation();
    }
  }
  
  // Handle force state update event
  private handleForceStateUpdate(data: any) {
    const { states, respawnedPlayerId, forceRemoveFromDeadPlayers } = data;
    
    // Force remove from deadPlayers set if flag is present
    if (forceRemoveFromDeadPlayers && respawnedPlayerId) {
      this.deadPlayers.delete(respawnedPlayerId);
      console.log(`Removed player ${respawnedPlayerId} from deadPlayers set due to force state update`);
    } else if (forceRemoveFromDeadPlayers) {
      // ë§ì½ ëª¨ë  ì¬ì©ììê² forceRemoveFromDeadPlayersê° trueì´ë©´
      // ëªìì ì¼ë¡ í¹ì  íë ì´ì´ê° ì§ì ëì§ ìì ê²½ì° ëª¨ë  deadPlayersë¥¼ ì´ê¸°í
      if (states) {
        states.forEach((state: any) => {
          // ìí ì²´í¬: ì´ììê³  ëªìì ì¼ë¡ forceRemoveFromDeadPlayersê° trueì¸ ê²½ì°
          if (state.health > 0 && (state.isRespawned || state.forceRemoveFromDeadPlayers)) {
            this.deadPlayers.delete(state.account);
          }
        });
      }
    }
    
    // Update all player states
    if (states && Array.isArray(states)) {
      this.updatePlayerStates(states);
    }
  }

  private handlePlayerHit(targetId: string, attackerId: string, projectileId: string) {
    console.log(`Player hit: targetId=${targetId}, attackerId=${attackerId}, projectileId=${projectileId}`);
    
    // ì°ê²° ëê¸´ íë ì´ì´ì ëí íí¸ë ë¬´ì
    if (this.disconnectedPlayers.has(targetId)) {
      console.log(`Ignoring hit for disconnected player: ${targetId}`);
      return;
    }
    
    // Skip if target player is dead
    if (targetId === this.myAccount && this.player.isDead()) return;
    if (targetId !== this.myAccount && this.otherPlayers.has(targetId) && this.otherPlayers.get(targetId)!.isDead()) return;
    
    const timestamp = Date.now();
    const damage = 10; // Fixed damage amount
    
    // Apply damage locally
    if (targetId === this.myAccount) {
      console.log(`Local player hit. Current health: ${this.player.health}`);
      this.player.damage(damage);
      
      // ì¹´ë©ë¼ í¨ê³¼ë¡ í¼ê²© ëëì ê°í
      this.cameras.main.shake(100, 0.01);
      
      const newHealth = this.player.health;
      console.log(`New health: ${newHealth}`);
      
      // Check if player died
      if (newHealth <= 0) {
        // Dispatch custom event for player death
        window.dispatchEvent(new CustomEvent('player-died'));
        // Add to dead players set
        this.deadPlayers.add(targetId);
      }
    } else if (this.otherPlayers.has(targetId)) {
      console.log(`Other player hit: ${targetId}. Exists: ${this.otherPlayers.has(targetId)}`);
      const targetPlayer = this.otherPlayers.get(targetId);
      if (targetPlayer) {
        console.log(`Other player health before damage: ${targetPlayer.health}`);
        targetPlayer.damage(damage);
        
        // Store the damaged player's new health and timestamp
        const newHealth =targetPlayer.health;
        this.damagedPlayers.set(targetId, newHealth);
        this.damageTimestamps.set(targetId, timestamp);
        
        console.log(`Other player health after damage: ${newHealth}`);
        console.log(`Stored in damagedPlayers: ${this.damagedPlayers.get(targetId)}`);
        
        // If player died, add to dead players set
        if (newHealth <= 0) {
          this.deadPlayers.add(targetId);
        }
      }
    }
    
    // Notify server if initialized
    if (this.serverInitialized) {
      // Send hit data to server
      this.server.remoteFunction("playerHit", [
        {
          targetId,
          attackerId,
          projectileId,
          damage,
          timestamp
        }
      ]);
      
      // Broadcast hit sync to all players in the room
      // This ensures everyone sees the same health values
      if (targetId !== this.myAccount) {
        const newHealth = this.damagedPlayers.get(targetId);
        this.server.remoteFunction("broadcastHitSync", [
          {
            targetId,
            attackerId,
            damage,
            newHealth,
            projectileId, // íë¡ì íì¼ IDë í¨ê» ì ì¡
            timestamp
          }
        ]);
      }
    }
  }

  // Respawn player at a specific position
  public respawnPlayer(x: number, y: number) {
    if (!this.player) return;
    
    console.log("Respawning local player at", x, y);
    
    // Set player position
    this.player.sprite.setPosition(x, y);
    
    // Reset player state
    this.player.reset();
    
    // Remove from dead players set
    this.deadPlayers.delete(this.myAccount);
    
    // Update server with new position and health
    if (this.serverInitialized) {
      this.updatePlayerOnServer();
    }
  }

  private updatePlayerOnServer() {
    if (!this.player || !this.serverInitialized || !this.server) return;
    
    // Get current animation state
    let currentAnimation = "idle";
    if (this.player.sprite.anims.currentAnim) {
      const animKey = this.player.sprite.anims.currentAnim.key;
      if (animKey.includes("walk")) {
        currentAnimation = "walk";
      } else if (animKey.includes("attack")) {
        currentAnimation = "attack";
      }
    }
    
    // Send position and animation data
    const playerData = {
      x: this.player.sprite.x,
      y: this.player.sprite.y,
      angle: this.player.sprite.angle,
      health: this.player.health,
      name: this.playerName,
      animation: currentAnimation,
      flipX: this.player.sprite.flipX,
      isDisconnected: false, // ëªìì ì¼ë¡ ì°ê²° ìí ì¤ì 
      isDead: this.player.isDead()
    };
    
    this.server.remoteFunction(
      "updatePlayerPosition",
      [playerData],
      { throttle: 50 }
    );
    
    // If animation changed, send specific animation update
    const lastAnimation = this.playerAnimations.get(this.myAccount) || "idle";
    if (currentAnimation !== lastAnimation) {
      this.playerAnimations.set(this.myAccount, currentAnimation);
      
      this.server.remoteFunction("updatePlayerAnimation", [
        {
          animation: currentAnimation,
          flipX: this.player.sprite.flipX
        }
      ]);
    }
  }

  updateRoomState(roomState: any) {
    // Create obstacles if not yet created and obstacle data exists
    if (!this.obstaclesCreated && roomState.obstacles) {
      this.createObstaclesFromServer(roomState.obstacles);
    }
    
    // Update game time if it has changed
    if (roomState && roomState.gameTime !== undefined && roomState.gameTime !== this.lastGameTime) {
      this.lastGameTime = roomState.gameTime;
      this.events.emit("updateGameTime", roomState.gameTime);
    }
  }

  // Get a unique color index for a player
  private getUniqueColorIndex(playerId: string): number {
    // Start from 1 because 0 is reserved for local player
    for (let i = 1; i < 9; i++) {
      if (!this.usedColorIndices.has(i)) {
        this.usedColorIndices.add(i);
        return i;
      }
    }
    
    // If all colors are used, generate a deterministic index based on player ID
    return Math.abs(this.hashCode(playerId) % 8) + 1;
  }
  
  // Simple string hash function
  private hashCode(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

  updatePlayerStates(playerStates: any[]) {
    if (!playerStates) return;
    
    // íì¬ ë°©ì ìë íë ì´ì´ ID ì¶ì 
    const currentPlayerIds = new Set(playerStates.map(p => p.account));
    
    playerStates.forEach(playerState => {
      const playerId = playerState.account;
      
      // Skip our own player (we handle our own state)
      if (playerId === this.myAccount) return;
      
      // ì°ê²°ì´ ëì´ì§ íë ì´ì´ë ì²ë¦¬íì§ ìì
      if (playerState.isDisconnected) {
        // ìì§ ì ê±°ëì§ ìì íë ì´ì´ì¸ ê²½ì° ì ê±°
        if (this.otherPlayers.has(playerId) && !this.disconnectedPlayers.has(playerId)) {
          console.log(`Player ${playerId} is marked as disconnected, removing`);
          this.handlePlayerDisconnected({ playerId, timestamp: Date.now() });
        }
        return;
      }
      
      // Check if we need to force remove from deadPlayers set
      if (playerState.forceRemoveFromDeadPlayers) {
        this.deadPlayers.delete(playerId);
        console.log(`Removed player ${playerId} from deadPlayers set due to forceRemoveFromDeadPlayers flag`);
      }
      
      if (playerState.x !== undefined && playerState.y !== undefined) {
        // Update existing player or create new one
        if (this.otherPlayers.has(playerId)) {
          const player = this.otherPlayers.get(playerId)!;
          
          // Update position with smooth movement
          player.moveTo(playerState.x, playerState.y);
          
          // Update sprite flip if provided
          if (playerState.flipX !== undefined) {
            player.sprite.setFlipX(playerState.flipX);
          }
          
          // Update animation if provided
          if (playerState.animation && playerState.animation !== this.playerAnimations.get(playerId)) {
            this.playerAnimations.set(playerId, playerState.animation);
            
            if (playerState.animation === "idle") {
              player.playIdleAnimation();
            } else if (playerState.animation === "walk") {
              player.playWalkAnimation();
            } else if (playerState.animation === "attack") {
              player.playAttackAnimation();
            }
          }
          
          // Health update logic - MODIFIED TO HANDLE RESPAWNS
          // ìí ìë°ì´í¸ ë¡ì§ ê°í: isDead íëê·¸ê° ìëì§ íì¸
          if (playerState.isDead) {
            // ìíì isDeadê° trueì¸ ê²½ì° ë¹íì±ííê³  deadPlayersì ì¶ê°
            player.setHealth(0);
            this.deadPlayers.add(playerId);
          } else if (this.deadPlayers.has(playerId) && !playerState.forceRemoveFromDeadPlayers) {
            // Player is dead and no force flag, ignore health updates from server
            console.log(`Ignoring health update for dead player ${playerId}`);
            // Ensure player remains dead visually
            if (player.health > 0) {
              player.setHealth(0);
            }
          } else {
            // Player is not dead or has force flag, proceed with normal health update logic
            const lastDamageTime = this.damageTimestamps.get(playerId) || 0;
            const currentTime = Date.now();
            
            // If player has respawned (health > 0 and was in deadPlayers), reset them
            if (playerState.health > 0 && this.deadPlayers.has(playerId)) {
              console.log(`Player ${playerId} has respawned, resetting state`);
              this.deadPlayers.delete(playerId);
              player.reset();
            }
            
            // If we have a recent local damage value (within last 2 seconds), use it
            // Otherwise use the server value
            if (this.damagedPlayers.has(playerId) && currentTime - lastDamageTime < 2000 && !playerState.forceRemoveFromDeadPlayers) {
              const localHealth = this.damagedPlayers.get(playerId);
              console.log(`Using locally tracked health for ${playerId}: ${localHealth}`);
              player.setHealth(localHealth);
              
              // If local health is 0, add to dead players set
              if (localHealth <= 0) {
                this.deadPlayers.add(playerId);
              }
            } else {
              // Use server health value
              player.setHealth(playerState.health || 100);
              // Update our local tracking to match server
              if (playerState.health !== undefined) {
                this.damagedPlayers.set(playerId, playerState.health);
                
                // If server health is 0, add to dead players set
                if (playerState.health <= 0 && !playerState.forceRemoveFromDeadPlayers) {
                  this.deadPlayers.add(playerId);
                }
              }
            }
          }
        } else {
          // ì°ê²°ì´ ëì´ì§ íë ì´ì´ë ì¬ìì±íì§ ìì
          if (this.disconnectedPlayers.has(playerId)) {
            console.log(`Not recreating disconnected player: ${playerId}`);
            return;
          }
          
          // Get a unique color index for this player
          const colorIndex = this.getUniqueColorIndex(playerId);
          
          // Create new player with the same texture as local player but different color
          const newPlayer = new Player(
            this,
            playerState.x,
            playerState.y,
            "knight", // Use the knight texture
            playerState.name || "Unknown",
            playerId,
            colorIndex
          );
          
          // Set initial health from server
          if (playerState.health !== undefined) {
            newPlayer.setHealth(playerState.health);
            
            // If player is joining with 0 health or is explicitly marked as dead, add to dead players set
            // Unless forceRemoveFromDeadPlayers is true
            if ((playerState.health <= 0 || playerState.isDead) && !playerState.forceRemoveFromDeadPlayers) {
              this.deadPlayers.add(playerId);
            }
          }
          
          // Set initial animation
          if (playerState.animation) {
            this.playerAnimations.set(playerId, playerState.animation);
            
            if (playerState.animation === "idle") {
              newPlayer.playIdleAnimation();
            } else if (playerState.animation === "walk") {
              newPlayer.playWalkAnimation();
            } else if (playerState.animation === "attack") {
              newPlayer.playAttackAnimation();
            }
          }
          
          // Set initial flip state
          if (playerState.flipX !== undefined) {
            newPlayer.sprite.setFlipX(playerState.flipX);
          }
          
          this.otherPlayers.set(playerId, newPlayer);
          
          // Set up collision if obstacles are already created
          if (this.obstaclesCreated) {
            this.physics.add.collider(newPlayer.sprite, this.obstacles);
          }
        }
      }
    });
    
    // Remove players that are no longer in the room
    this.otherPlayers.forEach((player, id) => {
      // íë ì´ì´ê° íì¬ ìí ëª©ë¡ì ìê³ , ì°ê²° ëê¹ ëª©ë¡ìë ìì¼ë©´ ì ê±°
      if (!currentPlayerIds.has(id) && !this.disconnectedPlayers.has(id)) {
        // Free up the color index when a player leaves
        const colorIndex = this.hashCode(id) % 8 + 1;
        this.usedColorIndices.delete(colorIndex);
        
        // Remove from tracking maps
        this.damagedPlayers.delete(id);
        this.damageTimestamps.delete(id);
        this.playerAnimations.delete(id);
        this.deadPlayers.delete(id);
        
        player.destroy();
        this.otherPlayers.delete(id);
        
        console.log(`Removed player not in current state: ${id}`);
      }
    });
  }
}
