export interface DockerNetworkEntry {
  IPAddress: string;
}

export interface DockerContainerState {
  Running: boolean;
  StartedAt: string;
  Health?: { Status: string };
  Status: string;
}

export interface DockerInspectEntry {
  NetworkSettings: {
    Networks: Record<string, DockerNetworkEntry>;
  };
  State: DockerContainerState;
  RestartCount: number;
}

export interface TraefikRouter {
  rule?: string;
  entryPoints?: string[];
  service?: string;
  tls?: Record<string, unknown>;
}

export interface TraefikService {
  loadBalancer?: {
    servers?: { url?: string }[];
  };
}

export interface TraefikDynamicConfig {
  http?: {
    routers?: Record<string, TraefikRouter>;
    services?: Record<string, TraefikService>;
  };
  tls?: {
    certificates?: { certFile: string; keyFile: string }[];
  };
}
