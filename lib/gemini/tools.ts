import { Type, type FunctionDeclaration, type Tool } from "@google/genai";

/**
 * Example tool: returns current time. Server-only (used in API route).
 * The client receives toolCall events and can send toolResponse via sendToolResponse().
 */
export const getCurrentTimeDeclaration: FunctionDeclaration = {
  name: "get_current_time",
  description:
    "Returns the current date and time in ISO format. Use when the user asks for the time or date.",
  parameters: {
    type: Type.OBJECT,
    properties: {},
  },
};

/** Default tools for Live API session (function calling). */
export const defaultLiveTools: Tool[] = [
  { functionDeclarations: [getCurrentTimeDeclaration] },
];
