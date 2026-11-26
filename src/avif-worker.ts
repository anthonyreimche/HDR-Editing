// The HDR AVIF worker: built on its own into dist/avif-worker.js
// (vite.worker.config.ts) and started by avif-worker-client.ts. The encoder's
// files load from the asset URLs each job carries.

import { liveAvifLoaders } from "./avif";
import { serveAvifJobs, type AvifWorkerScope } from "./avif-job";

// tsconfig's lib is the page's (DOM), which types `self` as a Window.
serveAvifJobs(self as unknown as AvifWorkerScope, liveAvifLoaders);
