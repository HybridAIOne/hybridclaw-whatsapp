declare module '@hybridaione/hybridclaw/plugin-sdk' {
  export interface MediaContextItem {
    path: string | null;
    url: string;
    originalUrl: string;
    mimeType: string | null;
    sizeBytes: number;
    filename: string;
  }

  export interface RuntimeWhatsAppConfig {
    dmPolicy: 'open' | 'pairing' | 'allowlist' | 'disabled';
    groupPolicy: 'open' | 'allowlist' | 'disabled';
    allowFrom: string[];
    groupAllowFrom: string[];
    textChunkLimit: number;
    debounceMs: number;
    sendReadReceipts: boolean;
    ackReaction: string;
    mediaMaxMb: number;
  }

  export interface PluginLogger {
    level: string;
    child(bindings: Record<string, unknown>): PluginLogger;
    trace(...args: unknown[]): void;
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  }

  export interface ChannelTransportMessageContext {
    abortSignal: AbortSignal;
    batchedMessages: unknown[];
    rawMessage: unknown;
    chatJid: string;
    senderJid: string;
    isGroup: boolean;
  }

  export type ChannelTransportReplyFn = (content: string) => Promise<void>;

  export type ChannelTransportMessageHandler = (
    sessionId: string,
    guildId: string | null,
    channelId: string,
    userId: string,
    username: string,
    content: string,
    media: MediaContextItem[],
    reply: ChannelTransportReplyFn,
    context: ChannelTransportMessageContext,
  ) => Promise<void>;

  export interface ChannelTransportMediaSendParams {
    jid: string;
    filePath: string;
    mimeType?: string | null;
    filename?: string | null;
    caption?: string;
  }

  export interface ChannelTransportPairingSession {
    start(): Promise<void>;
    waitForConnection(): Promise<{ id: string | null }>;
    stop(): Promise<void>;
  }

  export interface ChannelTransportSendResult {
    messageIds: string[];
  }

  export interface ChannelTransportInstance {
    init(handler: ChannelTransportMessageHandler): Promise<void>;
    shutdown(): Promise<void>;
    sendText(
      chatId: string,
      text: string,
    ): Promise<ChannelTransportSendResult> | Promise<void>;
    sendMedia(
      params: ChannelTransportMediaSendParams,
    ): Promise<ChannelTransportSendResult> | Promise<void>;
    createPairingSession?(): Promise<ChannelTransportPairingSession>;
  }

  export interface ChannelTransportHost<Config = unknown> {
    appVersion: string;
    defaultAgentId: string;
    logger: PluginLogger;
    getConfig(): Config;
    media: {
      createContextItem(params: {
        attachmentName: string;
        buffer: Buffer;
        mimeType?: string | null;
        sizeBytes?: number;
        originalUrl?: string | null;
      }): Promise<MediaContextItem>;
      normalizeMimeType(value: string | null | undefined): string | null;
      resolveManagedTempDir(params: { filePath: string }): string | null;
    };
    text: {
      chunkMessage(
        text: string,
        options: { maxChars: number; maxLines?: number },
      ): string[];
      normalizeNativeAgentAddressingText(text: string): string;
    };
    buildSessionKey(
      agentId: string,
      channelKind: string,
      chatType: string,
      peerId: string,
    ): string;
    describeExpectedTransportError(
      error: unknown,
      subject: string,
      fallbackHost?: string | null,
    ): string;
    isExpectedTransportError(error: unknown): boolean;
    SlidingWindowRateLimiter: new (
      windowMs?: number,
    ) => {
      check(
        key: string,
        limit: number,
        nowMs?: number,
      ): { allowed: boolean; remaining: number; retryAfterMs: number };
      shouldNotify(key: string, cooldownMs?: number, nowMs?: number): boolean;
    };
    sleep(ms: number): Promise<void>;
    renderQrSvg(input: string, ariaLabel?: string): string;
  }

  export interface ChannelTransportAuthStatus {
    linked: boolean;
    [field: string]: unknown;
  }

  export interface ChannelTransportPairingState {
    pairingQrText: string | null;
    updatedAt: string | null;
    error: string | null;
    [field: string]: unknown;
  }

  export interface ChannelTransportDoctorFinding {
    severity: 'ok' | 'warn' | 'error';
    message: string;
  }

  export interface ChannelTransportSendDescription {
    sentFrom: string;
    recipient: string;
    note?: string;
  }

  export interface ChannelTransportRegistration {
    kind: string;
    create(host: ChannelTransportHost): ChannelTransportInstance;
    matchesTarget(target: string): boolean;
    normalizeTarget(target: string): string | null;
    getAuthStatus(): Promise<ChannelTransportAuthStatus>;
    resetAuth(): Promise<string>;
    getPairingState?(): ChannelTransportPairingState;
    /** `deliveryTarget` is the heartbeat or most recent session channel; older cores omit it. */
    doctorChecks?(params: {
      enabled: boolean;
      deliveryTarget?: string | null;
    }): Promise<ChannelTransportDoctorFinding[]>;
    messageToolHints?(params: { channelId: null }): string[];
    describeSend?(params: {
      target: string;
      auth: ChannelTransportAuthStatus;
    }): ChannelTransportSendDescription;
  }

  export interface PluginRuntime {
    readonly cwd: string;
    readonly homeDir: string;
    readonly installRoot: string;
    readonly runtimeConfigPath: string;
  }

  export interface HybridClawPluginApi {
    readonly config: Readonly<{ whatsapp: RuntimeWhatsAppConfig }>;
    readonly runtime: PluginRuntime;
    registerChannelTransport(transport: ChannelTransportRegistration): void;
  }

  export interface HybridClawPluginDefinition {
    id: string;
    name?: string;
    version?: string;
    kind?: 'channel';
    register(api: HybridClawPluginApi): void;
  }
}
