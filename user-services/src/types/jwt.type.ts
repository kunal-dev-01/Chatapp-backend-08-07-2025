export interface TokenPayload {
  id: string;
  username: string;
  email: string;
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface DecodedToken extends TokenPayload {
  iat: number;
  exp: number;
}