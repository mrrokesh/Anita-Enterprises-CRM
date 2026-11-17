export const env = {
  /** Express API. See backend/.env.example. */
  apiBaseUrl:
    (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000/api',
  /** Backend proxy for AI calls. No provider keys ever live in the frontend. */
  aiProxyUrl: import.meta.env.VITE_AI_PROXY_URL as string | undefined,
}
