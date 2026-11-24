declare module "./.open-next/worker.js" {
  const openNextWorker: {
    fetch(request: Request, env: unknown, ctx: unknown): Promise<Response>;
  };
  export default openNextWorker;
  export const DOQueueHandler: unknown;
  export const DOShardedTagCache: unknown;
  export const BucketCachePurge: unknown;
}
