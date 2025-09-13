/**
 * 載入頁面管理器
 * 提供統一的載入動畫顯示和移除功能
 */
class LoadingManager {
  private static instance: LoadingManager;
  private loadingElement: HTMLElement | null = null;
  private styleElement: HTMLStyleElement | null = null;
  private isLoading = false;
  private timeoutId: number | null = null;

  // Loading animation configuration
  private readonly config = {
    timeout: 10000, // 10 seconds timeout
    animationDuration: 2000, // animation duration
    backgroundColor: "#ffffff",
    spinnerColor: "#007bff",
    textColor: "#333333",
    spinnerSize: 50,
    zIndex: 9999
  };

  // Style template
  private readonly styles = `
    .app-loading-container {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background: ${this.config.backgroundColor};
      z-index: ${this.config.zIndex};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .app-loading-spinner {
      width: ${this.config.spinnerSize}px;
      height: ${this.config.spinnerSize}px;
      border: 3px solid rgba(0, 123, 255, 0.1);
      border-top: 3px solid ${this.config.spinnerColor};
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    .app-loading-text {
      color: ${this.config.textColor};
      margin-top: 20px;
      font-size: 14px;
      opacity: 0.8;
      animation: fadeInOut 2s ease-in-out infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    @keyframes fadeInOut {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
  `;

  private constructor() {}

  static getInstance(): LoadingManager {
    if (!LoadingManager.instance) {
      LoadingManager.instance = new LoadingManager();
    }
    return LoadingManager.instance;
  }

  /**
   * Show loading animation
   */
  show(text = "Loading..."): void {
    if (this.isLoading) {
      console.warn("載入動畫已經在顯示中");
      return;
    }

    try {
      this.createElements();
      this.updateText(text);
      this.isLoading = true;

      // Set timeout protection
      this.timeoutId = window.setTimeout(() => {
        console.warn("Loading timeout, automatically removing loading animation");
        this.hide();
      }, this.config.timeout);

    } catch (error) {
      console.error("Failed to show loading animation:", error);
      this.cleanup();
    }
  }

  /**
   * Update loading text
   */
  updateText(text: string): void {
    if (this.loadingElement) {
      const textElement = this.loadingElement.querySelector(".app-loading-text");
      if (textElement) {
        textElement.textContent = text;
      }
    }
  }

  /**
   * Hide loading animation
   */
  hide(): void {
    if (!this.isLoading) {
      return;
    }

    try {
      this.cleanup();
      this.isLoading = false;
    } catch (error) {
      console.error("Failed to hide loading animation:", error);
    }
  }

  /**
   * Create loading elements
   */
  private createElements(): void {
    // 創建樣式元素
    this.styleElement = document.createElement("style");
    this.styleElement.id = "app-loading-styles";
    this.styleElement.textContent = this.styles;
    document.head.appendChild(this.styleElement);

    // 創建載入容器
    this.loadingElement = document.createElement("div");
    this.loadingElement.id = "app-loading-container";
    this.loadingElement.className = "app-loading-container";
    this.loadingElement.innerHTML = `
      <div class="app-loading-spinner"></div>
      <div class="app-loading-text">Loading...</div>
    `;

    document.body.appendChild(this.loadingElement);
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    // 清除超時
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    // 移除元素
    if (this.styleElement && this.styleElement.parentNode) {
      this.styleElement.parentNode.removeChild(this.styleElement);
      this.styleElement = null;
    }

    if (this.loadingElement && this.loadingElement.parentNode) {
      this.loadingElement.parentNode.removeChild(this.loadingElement);
      this.loadingElement = null;
    }
  }

  /**
   * Check if loading is active
   */
  isLoadingActive(): boolean {
    return this.isLoading;
  }
}

/**
 * DOM utility class
 */
class DOMUtils {
  /**
   * Wait for DOM to be ready
   */
  static ready(condition: DocumentReadyState[] = ["complete", "interactive"]): Promise<boolean> {
    return new Promise((resolve) => {
      if (condition.includes(document.readyState)) {
        resolve(true);
      } else {
        document.addEventListener("readystatechange", () => {
          if (condition.includes(document.readyState)) {
            resolve(true);
          }
        });
      }
    });
  }

  /**
   * Safely append element
   */
  static safeAppend(parent: HTMLElement, child: HTMLElement): void {
    if (!parent.contains(child)) {
      parent.appendChild(child);
    }
  }

  /**
   * Safely remove element
   */
  static safeRemove(parent: HTMLElement, child: HTMLElement): void {
    if (parent.contains(child)) {
      parent.removeChild(child);
    }
  }
}

/**
 * Application initializer manager
 */
class AppInitializer {
  private loadingManager: LoadingManager;
  private initializationSteps: Array<() => Promise<void>> = [];

  constructor() {
    this.loadingManager = LoadingManager.getInstance();
    this.setupMessageHandlers();
  }

  /**
   * Add initialization step
   */
  addInitializationStep(step: () => Promise<void>): void {
    this.initializationSteps.push(step);
  }

  /**
   * Execute initialization
   */
  async initialize(): Promise<void> {
    try {
      console.log("Starting application initialization...");
      
      // Show loading animation
      this.loadingManager.show("Initializing application...");
      
      // Wait for DOM to be ready
      this.loadingManager.updateText("Preparing interface...");
      await DOMUtils.ready();
      
      // Execute all initialization steps
      for (let i = 0; i < this.initializationSteps.length; i++) {
        const step = this.initializationSteps[i];
        this.loadingManager.updateText(`Executing step ${i + 1}/${this.initializationSteps.length}...`);
        await step();
      }
      
      // Simulate some loading time to let users see the loading animation
      this.loadingManager.updateText("Almost complete...");
      await this.delay(500);
      
      console.log("Application initialization completed");
      
    } catch (error) {
      console.error("Application initialization failed:", error);
      this.loadingManager.updateText("Initialization failed, please restart the application");
      throw error;
    } finally {
      // Delay a bit before hiding to let users see the completion status
      setTimeout(() => {
        this.loadingManager.hide();
      }, 300);
    }
  }

  /**
   * Setup message handlers
   */
  private setupMessageHandlers(): void {
    window.addEventListener("message", (event) => {
      if (event.data?.type === "loading") {
        switch (event.data.payload) {
          case "show":
            this.loadingManager.show(event.data.text || "Loading...");
            break;
          case "hide":
            this.loadingManager.hide();
            break;
          case "updateText":
            this.loadingManager.updateText(event.data.text || "");
            break;
        }
      }
    });
  }

  /**
   * Delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ----------------------------------------------------------------------

// Create application initializer instance
const appInitializer = new AppInitializer();

// Start initialization when DOM is ready
DOMUtils.ready().then(() => {
  // Add some basic initialization steps
  appInitializer.addInitializationStep(async () => {
    // Actual initialization logic can be added here
    console.log("Executing basic initialization...");
  });

  // Start initialization
  appInitializer.initialize().catch((error) => {
    console.error("Error occurred during initialization:", error);
  });
});

// Expose loading manager to global scope for other scripts to use
(window as any).loadingManager = LoadingManager.getInstance();
