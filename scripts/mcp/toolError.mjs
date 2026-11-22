/**
 * A failure an agent can act on: its message goes back as the tool's result,
 * in words — never a stack trace. Its own module so the tool modules can all
 * throw it without importing one another.
 */
export class ToolError extends Error {}
