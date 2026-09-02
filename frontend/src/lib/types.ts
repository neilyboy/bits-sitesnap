export interface CategoryDTO {
  id: number;
  name: string;
  slug: string;
  sort_order: number;
  is_default: boolean;
}

export interface SiteDTO {
  id: number;
  client_uuid: string;
  business_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  surveyor_name: string;
  survey_date: string;
  general_notes: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  sync_status: string;
  deleted: boolean;
  item_count: number;
}

export interface ItemDTO {
  id: number;
  client_uuid: string;
  site_id: number;
  category: string;
  label: string;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  sync_status: string;
  deleted: boolean;
  image_count: number;
}

export interface ImageDTO {
  id: number;
  client_uuid: string;
  item_id: number;
  filename: string;
  mime: string;
  width: number;
  height: number;
  taken_at: string;
  sha256: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  sync_status: string;
  deleted: boolean;
  url: string;
}

export interface AudioDTO {
  id: number;
  client_uuid: string;
  item_id: number;
  duration_sec: number;
  transcript_text: string;
  transcript_status: string;
  transcript_error: string;
  created_at: string;
  updated_at: string;
  server_updated_at: string;
  sync_status: string;
  deleted: boolean;
}

export interface TokenDTO {
  token: string;
  expires_at: string;
}

export interface SyncPushPayload {
  sites: SiteInDTO[];
  items: ItemInDTO[];
  image_metas: ImageMetaDTO[];
  audio_metas: AudioMetaDTO[];
}

export interface SiteInDTO {
  client_uuid: string;
  business_name: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  zip: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  surveyor_name: string;
  survey_date: string;
  general_notes: string;
}

export interface ItemInDTO {
  client_uuid: string;
  site_client_uuid: string;
  category: string;
  label: string;
  notes: string;
  sort_order: number;
}

export interface ImageMetaDTO {
  client_uuid: string;
  item_client_uuid: string;
  filename: string;
  mime: string;
  width: number;
  height: number;
  taken_at: string;
  sha256: string;
  sort_order: number;
}

export interface AudioMetaDTO {
  client_uuid: string;
  item_client_uuid: string;
  duration_sec: number;
  transcript_text: string;
  transcript_status: string;
}

export interface SyncPushResponse {
  server_time: string;
  sites: SiteDTO[];
  items: ItemDTO[];
  images: ImageDTO[];
  audio: AudioDTO[];
}

export interface SyncPullResponse {
  server_time: string;
  sites: SiteDTO[];
  items: ItemDTO[];
  images: ImageDTO[];
  audio: AudioDTO[];
  categories: CategoryDTO[];
}
