export class WaAgentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaAgentError';
  }
}

export class ConfigError extends WaAgentError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class AgentError extends WaAgentError {
  constructor(public agentName: string, message: string) {
    super(`[${agentName}] ${message}`);
    this.name = 'AgentError';
  }
}

export class ToolError extends WaAgentError {
  constructor(public toolName: string, message: string) {
    super(`Tool '${toolName}': ${message}`);
    this.name = 'ToolError';
  }
}

export class RoutingError extends WaAgentError {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}
