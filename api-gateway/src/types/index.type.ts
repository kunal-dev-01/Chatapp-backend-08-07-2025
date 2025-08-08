import { Options} from 'http-proxy-middleware';

export interface ServiceConfig {
  name: string;
  url: string;
  path: string;
  timeout?: number;
}

export interface ProxyOptions extends Options {
  pathRewrite?: { [key: string]: string };
}