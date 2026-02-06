export interface ApiTopicListItem {
  id: number;
  uuid: string;
  queries: string[];
  last_fetched_at: string | null;
  content_source_count: number;
  is_active: boolean;
  group_uuid: string | null;
  group_name: string | null;
  owner_username: string;
  is_owner: boolean;
  search_domain_allowlist: string[] | null;
  search_domain_blocklist: string[] | null;
  search_language_filter: string[] | null;
  country: string | null;
  update_frequency: "day" | "week" | "manual";
  additional_queries_mode: "auto" | "manual";
}

export interface ApiTopicListResponse {
  topics: ApiTopicListItem[];
}

export interface ApiTopicCreateResponse {
  topic: ApiTopicListItem;
}

export interface ApiTopicGroupItem {
  id: number;
  uuid: string;
  name: string;
  description: string;
  is_public: boolean;
  owner_username: string;
  is_owner: boolean;
  default_update_frequency: "day" | "week" | "manual" | null;
  default_search_language_filter: string[] | null;
  default_country: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiTopicGroupListResponse {
  groups: ApiTopicGroupItem[];
}

export interface ApiTopicGroupCreateResponse {
  group: ApiTopicGroupItem;
}

export interface ApiCurrentUser {
  id: number;
  username: string;
  email: string;
  is_pro: boolean;
  pro_plan: "monthly" | "yearly" | null;
}

export interface ApiAccessState {
  is_pro: boolean;
  api_key: string | null;
  key_created_at: string | null;
}

export interface ApiNotificationTopicItem {
  topic_uuid: string;
  topic_queries: string[];
  group_uuid: string | null;
  group_name: string | null;
  new_count: number;
}

export interface ApiNotificationsResponse {
  total_new: number;
  topics: ApiNotificationTopicItem[];
}

export interface ApiContentFeedItem {
  id: number;
  url: string;
  title: string;
  summary: string;
  source: string;
  created_at: string;
  published_at: string | null;
  topic_uuid: string;
  topic_queries: string[];
  relevance_score: number | null;
  is_bookmarked: boolean;
}

export interface ApiContentDetailItem extends ApiContentFeedItem {
  content: string;
}

export interface ApiContentFeedResponse {
  items: ApiContentFeedItem[];
}

export interface ApiAIInteractionResponse {
  answer: string;
  model: string;
  response_id: string | null;
  content_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
}

export interface ApiSearchTopicItem {
  id: number;
  uuid: string;
  queries: string[];
  last_fetched_at: string | null;
  content_source_count: number;
  is_active: boolean;
  group_uuid: string | null;
  group_name: string | null;
}

export interface ApiSearchContentItem {
  id: number;
  url: string;
  title: string;
  summary: string;
  source: string;
  created_at: string;
  published_at: string | null;
  topic_uuid: string;
  topic_queries: string[];
  group_uuid: string | null;
  is_bookmarked: boolean;
}

export interface ApiSearchResponse {
  topics: ApiSearchTopicItem[];
  contents: ApiSearchContentItem[];
}

export type ApiExecutionStatus = "created" | "running" | "completed" | "failed";

export interface ApiExecutionDetail {
  id: number;
  status: ApiExecutionStatus;
  initiator: string;
  created_at: string;
  content_item_id: number | null;
  error_message: string | null;
}

export interface TopicItem {
  id: number;
  uuid: string;
  queries: string[];
  term: string;
  category: string;
  isActive: boolean;
  lastSearch: Date | null;
  hasNewItems: boolean;
  groupUuid: string | null;
  groupName: string | null;
  ownerUsername: string;
  isOwner: boolean;
  domainAllowlist: string[] | null;
  domainBlocklist: string[] | null;
  languageFilter: string[] | null;
  country: string | null;
  updateFrequency: "day" | "week" | "manual";
  additionalQueriesMode: "auto" | "manual";
}

export interface NewsItem {
  id: number;
  title: string;
  summary: string;
  source: string;
  timestamp: Date;
  fetchedAt: Date;
  relevanceScore: number;
  keywords: string[];
  category: "technology" | "business" | "science" | "politics" | "general";
  url: string;
  isBookmarked: boolean;
}
