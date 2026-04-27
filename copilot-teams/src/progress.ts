/** Common progress-reporter type. The MCP server wraps each tool call with a
 *  reporter that, when the client requested progress (via _meta.progressToken
 *  in the request), emits notifications/progress messages. Tools should call
 *  it at any non-trivial milestone — it's a no-op when the client didn't ask. */
export type ProgressReporter = (
  progress: number,
  total?: number,
  message?: string,
) => Promise<void>;

export const noopProgress: ProgressReporter = async () => {};
