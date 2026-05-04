export type TopicUpdateFrequency = "auto" | "hour" | "day" | "week" | "manual";

export interface ApiTopicOrganizerResponse {
  display_title: string;
  query_variations: string[];
  suggested_domains: string[];
  country: string | null;
  search_language_filter: string[] | null;
  topic_warning: string | null;
}

export interface ApiTopicPreviewResult {
  url: string;
  title: string;
  snippet: string;
  domain: string;
  published_at: string | null;
}

export interface ApiTopicPreviewResponse {
  items: ApiTopicPreviewResult[];
}

export interface ApiTopicSuggestDomainsResponse {
  domains: string[];
}

export interface ApiTopicListItem {
  id: number;
  uuid: string;
  monitoring_prompt: string;
  display_title: string;
  queries: string[];
  last_fetched_at: string | null;
  content_source_count: number;
  is_active: boolean;
  group_uuid: string | null;
  group_name: string | null;
  owner_username: string;
  is_owner: boolean;
  search_domain_allowlist: string[] | null;
  search_language_filter: string[] | null;
  country: string | null;
  update_frequency: TopicUpdateFrequency;
  auto_effective_interval_hours: number | null;
  auto_interval_updated_at: string | null;
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
  owner_username: string;
  is_owner: boolean;
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

export interface ApiTrashContentItem {
  id: number;
  url: string;
  title: string;
  summary: string;
  source: string;
  created_at: string;
  published_at: string | null;
  deleted_at: string;
  topic_uuid: string;
  topic_queries: string[];
}

export interface ApiTrashContentResponse {
  items: ApiTrashContentItem[];
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
  monitoringPrompt: string;
  displayTitle: string;
  queries: string[];
  term: string;
  isActive: boolean;
  lastSearch: Date | null;
  hasNewItems: boolean;
  groupUuid: string | null;
  groupName: string | null;
  ownerUsername: string;
  isOwner: boolean;
  domainAllowlist: string[] | null;
  languageFilter: string[] | null;
  country: string | null;
  updateFrequency: TopicUpdateFrequency;
  autoEffectiveIntervalHours: number | null;
  autoIntervalUpdatedAt: Date | null;
}

export interface TopicDraft {
  monitoringPrompt: string;
  displayTitle: string;
  queries: string[];
  suggestedDomains: string[];
  topicWarning: string | null;
  limitToSelectedDomains: boolean;
  domainAllowlist: string[];
  languageFilter: string[];
  country: string;
  updateFrequency: TopicUpdateFrequency;
  autoEffectiveIntervalHours: number | null;
}

export type TopicPreviewReaction = "up" | "down" | null;

export interface NewsItem {
  id: number;
  title: string;
  summary: string;
  source: string;
  timestamp: Date;
  fetchedAt: Date;
  relevanceScore: number;
  keywords: string[];
  url: string;
  isBookmarked: boolean;
}
