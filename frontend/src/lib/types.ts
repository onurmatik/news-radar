export interface ApiTopicListItem {
  id: number;
  uuid: string;
  queries: string[];
  last_fetched_at: string | null;
  content_source_count: number;
  is_active: boolean;
  group_uuid: string | null;
  group_name: string | null;
  search_domain_allowlist: string[] | null;
  search_domain_blocklist: string[] | null;
  search_language_filter: string[] | null;
  country: string | null;
  search_recency_filter: "day" | "week" | "month" | "year" | null;
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
  default_search_recency_filter: "day" | "week" | "month" | "year" | null;
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

export interface ApiContentFeedResponse {
  items: ApiContentFeedItem[];
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
  domainAllowlist: string[] | null;
  domainBlocklist: string[] | null;
  languageFilter: string[] | null;
  country: string | null;
  searchRecencyFilter: "day" | "week" | "month" | "year" | null;
}

export interface NewsItem {
  id: number;
  title: string;
  summary: string;
  source: string;
  timestamp: Date;
  relevanceScore: number;
  keywords: string[];
  category: "technology" | "business" | "science" | "politics" | "general";
  url: string;
  isBookmarked: boolean;
}
