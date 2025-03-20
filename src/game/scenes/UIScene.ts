import Phaser from "phaser";

export class UIScene extends Phaser.Scene {
  private healthBar!: Phaser.GameObjects.Graphics;
  private healthText!: Phaser.GameObjects.Text;
  private gameTimeText!: Phaser.GameObjects.Text;
  private gameScene!: Phaser.Scene;
  private gameTimeBackground!: Phaser.GameObjects.Graphics;
  
  constructor() {
    super({ key: "UIScene" });
  }
  
  create() {
    this.gameScene = this.scene.get("GameScene");
    
    // Create health bar
    this.healthBar = this.add.graphics();
    this.healthBar.setScrollFactor(0);
    
    // Create health text
    this.healthText = this.add.text(20, 20, "Health: 100", {
      fontSize: "16px",
      color: "#ffffff"
    });
    this.healthText.setScrollFactor(0);
    
    // Create game time display at the top center of the screen
    this.createGameTimeDisplay();
    
    // Listen for health changes
    this.gameScene.events.on("updateHealth", this.updateHealth, this);
    
    // Listen for game time updates
    this.gameScene.events.on("updateGameTime", this.updateGameTime, this);
    
    // Make sure UI stays on top
    this.scene.bringToTop();
  }
  
  private createGameTimeDisplay() {
    // Get canvas width for positioning
    const width = this.cameras.main.width;
    
    // Create background for game time
    this.gameTimeBackground = this.add.graphics();
    this.gameTimeBackground.setScrollFactor(0);
    this.gameTimeBackground.fillStyle(0x000000, 0.5);
    this.gameTimeBackground.fillRoundedRect(width / 2 - 50, 10, 100, 30, 6);
    
    // Create game time text
    this.gameTimeText = this.add.text(width / 2, 25, "Time: 0s", {
      fontSize: "14px",
      color: "#ffffff",
      fontStyle: "bold"
    });
    this.gameTimeText.setScrollFactor(0);
    this.gameTimeText.setOrigin(0.5);
    
    // Handle window resize to reposition the game time text
    this.scale.on('resize', this.handleResize, this);
  }
  
  private handleResize() {
    if (!this.gameTimeText || !this.gameTimeBackground) return;
    
    const width = this.cameras.main.width;
    
    // Reposition text
    this.gameTimeText.setPosition(width / 2, 25);
    
    // Redraw background
    this.gameTimeBackground.clear();
    this.gameTimeBackground.fillStyle(0x000000, 0.5);
    this.gameTimeBackground.fillRoundedRect(width / 2 - 50, 10, 100, 30, 6);
  }
  
  updateHealth(health: number) {
    // Update health text
    this.healthText.setText(`Health: ${health}`);
    
    // Update health bar
    this.healthBar.clear();
    
    // Background
    this.healthBar.fillStyle(0x000000, 0.5);
    this.healthBar.fillRect(20, 40, 200, 20);
    
    // Health amount
    if (health > 60) {
      this.healthBar.fillStyle(0x00ff00, 1);
    } else if (health > 30) {
      this.healthBar.fillStyle(0xffff00, 1);
    } else {
      this.healthBar.fillStyle(0xff0000, 1);
    }
    
    this.healthBar.fillRect(20, 40, 2 * health, 20);
  }
  
  updateGameTime(gameTime: number) {
    if (!this.gameTimeText) return;
    
    // Format the time as seconds
    const seconds = Math.floor(gameTime / 1000);
    this.gameTimeText.setText(`Time: ${seconds}s`);
  }
}
