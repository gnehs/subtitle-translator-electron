# 更新日誌 / Changelog

本檔案依照 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 編排，並遵循語意化版本原則。
This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and Semantic Versioning.

## [Unreleased]

## [2.0.0] - 2026-07-13

本版本整理自 1.8.0 以來的所有重要變更。
This release consolidates the notable changes made since 1.8.0.

### Added / 新增

- **中文：** 新增可中斷並恢復的 JSON 翻譯檢查點；使用者可以將檢查點檔案拖回應用程式，繼續未完成的翻譯。
  **English:** Added resumable JSON translation checkpoints. Users can drag a checkpoint back into the app to continue an interrupted translation.
- **中文：** 新增 API 連線測試與遠端模型載入狀態，方便在開始翻譯前確認設定是否可用。
  **English:** Added API connection testing and remote model loading feedback so settings can be verified before translation starts.
- **中文：** 新增翻譯上下文大小、並行數與每分鐘請求數設定。
  **English:** Added settings for translation context size, concurrency, and requests per minute.
- **中文：** 新增更完整的任務進度、字幕預覽、Markdown 說明與空狀態畫面。
  **English:** Added richer task progress, subtitle previews, Markdown guidance, and empty states.
- **中文：** 新增介面、原生選單與錯誤訊息的完整本地化支援，涵蓋英文、簡體中文與繁體中文。
  **English:** Added complete localization for the interface, native menus, and error messages in English, Simplified Chinese, and Traditional Chinese.

### Changed / 變更

- **中文：** 重整翻譯流程，採用滑動上下文視窗與串流結構化輸出，以保留前後文、穩定預覽對齊，並改善批次翻譯的重試、速率限制與可靠性。
  **English:** Reworked the translation flow with sliding context windows and streamed structured outputs to preserve surrounding context, stabilize preview alignment, and improve retries, rate limiting, and batch reliability.
- **中文：** 翻譯執行期間可以新增、移除與管理任務，不必等待目前工作完成。
  **English:** Tasks can now be added, removed, and managed while translations are running.
- **中文：** 重整 Electron 橋接層、UI 元件與圖示系統，並遷移至 pnpm 以及新的品質檢查與發布流程。
  **English:** Modernized the Electron bridge, UI components, and icon system, and migrated the project to pnpm with updated quality and release workflows.
- **中文：** 改善設定頁、模型選擇與 OpenRouter 使用指引。
  **English:** Refined the settings page, model selection, and OpenRouter guidance.

### Fixed / 修正

- **中文：** 變更翻譯設定時保留已完成的檢查點內容，只重新計算受設定影響的分析；翻譯成功完成後會自動清理檢查點。
  **English:** Preserved completed checkpoint translations when settings change, recalculating only configuration-dependent analysis; checkpoints are removed after successful completion.
- **中文：** 修正重複字幕、長字幕與字幕切分的邊界情況，避免翻譯結果錯位或失敗。
  **English:** Fixed edge cases involving repeated subtitles, long subtitles, and chunk boundaries to prevent misaligned or failed translations.
- **中文：** 修正語言選擇無法跨應用程式重啟保存、原生選單不同步，以及打包版本錯誤碼處理不一致的問題。
  **English:** Fixed locale persistence across app restarts, native menu synchronization, and inconsistent error-code handling in packaged builds.
- **中文：** 修正遠端模型重新整理、版本更新通知比較、加入任務對話框捲動，以及咖啡贊助橫幅的文字排版問題。
  **English:** Fixed remote model refresh, release-version comparison for update notifications, add-task dialog scrolling, and text layout in the coffee-support banner.
- **中文：** 修正測試與 GitHub Actions 在不同平台上的路徑處理與 pnpm 安裝問題。
  **English:** Fixed cross-platform path handling in tests and pnpm installation in GitHub Actions.

## [1.8.0] - 2025-09-15

### Changed / 變更

- **中文：** 提升批次翻譯並行度至 10，簡化翻譯核心與分析輸出。
  **English:** Increased batch translation concurrency to 10 and simplified the translation core and analysis output.

### Removed / 移除

- **中文：** 移除 Economy／Compatibility 模式與自訂 API header 支援。
  **English:** Removed Economy/Compatibility modes and custom API header support.

### Fixed / 修正

- **中文：** 修正 API provider 選擇在頁面導覽後未能正確保存的問題。
  **English:** Fixed API provider selection not persisting correctly after navigating between settings pages.

[Unreleased]: https://github.com/gnehs/subtitle-translator-electron/compare/2.0.0...HEAD
[2.0.0]: https://github.com/gnehs/subtitle-translator-electron/compare/1.8.0...2.0.0
[1.8.0]: https://github.com/gnehs/subtitle-translator-electron/compare/1.7.0...1.8.0
