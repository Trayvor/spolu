/**
 * The bulk email screens as one lazy chunk: the list is small (about 1 kB gzip), and two
 * chunks sharing the API module made the bundler split `useBaseQuery` out of the entry chunk
 * into its own eagerly loaded chunk (+1.4 kB gzip of initial JS). See
 * docs/architecture/performance.md.
 */
export { CampaignListPage } from './campaign-list-page';
export { CampaignPageRoute } from './editor-page';
