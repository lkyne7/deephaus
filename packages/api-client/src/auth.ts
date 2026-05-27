export type AuthUser = {
  id: string;
  email?: string | null;
};

export type AuthReader = {
  getSession: () => Promise<{ data: { session: { access_token: string; user: AuthUser } | null } }>;
  getUser: () => Promise<{ data: { user: AuthUser | null } }>;
};

export async function getAuthSession(auth: AuthReader) {
  const { data } = await auth.getSession();
  return data.session;
}

export async function getCurrentUser(auth: AuthReader) {
  const { data } = await auth.getUser();
  return data.user;
}

export function mapAuthUser(user: AuthUser) {
  return { id: user.id, email: user.email ?? null };
}
