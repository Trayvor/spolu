/**
 * The weekly summary screens as one lazy chunk (as the bulk email screens): they share the API
 * module, and separate chunks would split shared query code out of the entry chunk.
 */
export { WeeklySummaryListPage } from './list-page';
export { WeeklySummaryArchivePage } from './archive-page';
export { WeeklySummaryEditorRoute } from './editor-page';
