export interface AuthUser { uid: string; email: string; getIdToken(): Promise<string> }
export interface AuthAdapter { currentUser(): AuthUser | null; subscribe(listener: (user: AuthUser | null) => void): () => void; signIn(): Promise<void>; signOut(): Promise<void> }
export interface Profile { user_id: string; user_email: string; user_name: string; user_address: string; user_lat: number | null; user_long: number | null; budget: 'any'|'under100'|'100to250'|'over250'; age?: number; food_interests: string[]; food_notes: string }
export interface VideoComment { id: string; text: string; sentiment: 'good'|'neutral'|'negative'; likes: number }
export interface SourceVideo { video_id: string; platform: 'youtube'|'tiktok'; video_url: string; title?: string; thumbnail_url: string|null; script_text: string|null; duration_seconds: number; is_food_beverage: boolean; comments?: VideoComment[] }
export interface Restaurant { restaurant_id: string; video_id: string; user_id: string; doc_id?: string; cate_id: number; restaurant_name: string; dish: string; address: string; price_vnd: number|null; price_vnd_max: number|null; latitude: number|null; longitude: number|null; is_saved: 0|1; shopeefood_kinds: 'store'|'search'|'unknown'|null; shopeefood_url: string|null; thumbnail_url: string|null; match_score?: number; user_note: string; create_time?: string; update_time?: string; title?: string; script_text?: string|null; video_url?: string; platform?: 'youtube'|'tiktok' }
export interface Category { cate_id: number; cate_name_en: string; cate_name_vn: string }
export interface Address { id: string; label: string; latitude: number; longitude: number; provider: 'mock'|'api' }
export interface Reference { video_id: string; restaurant_id: string; doc_id?: string; video_url?: string }
export interface AskResponse { session_id: string; answer: string; references: Reference[]; demo?: { key: string; count?: number; amount?: string; text?: string; notes?: string } }
export interface ChatMessage { id: string; role: 'user'|'assistant'; content: string; created_at: string; references?: Reference[]; demo?: AskResponse['demo'] }
export interface ChatSession { id: string; uid: string; title: string; created_at: string; updated_at: string; messages: ChatMessage[] }
export interface Snapshot { profile: Profile; restaurants: Restaurant[]; videos: SourceVideo[]; sessions: ChatSession[]; activeSession: string|null }
export interface Analysis { video: SourceVideo; restaurants: Restaurant[] }
export type Edits = Pick<Restaurant,'restaurant_name'|'dish'|'price_vnd'|'address'|'user_note'>;
