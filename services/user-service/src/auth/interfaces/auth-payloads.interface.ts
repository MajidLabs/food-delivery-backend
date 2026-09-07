export interface RegisterPayload {
  email: string;
  password: string;
  fullName: string;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface SafeUser {
  id: string;
  email: string;
  fullName: string;
  createdAt: Date;
}

export interface LoginResult {
  accessToken: string;
  user: SafeUser;
}
