import { addHours, subMinutes } from "date-fns";

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  timestamp: Date;
  relevanceScore: number;
  keywords: string[];
  category: "technology" | "business" | "science" | "politics" | "general";
  url: string;
}

export interface Keyword {
  id: string;
  term: string;
  category: string;
  isActive: boolean;
  lastSearch: Date | null;
}

export const MOCK_KEYWORDS: Keyword[] = [
  { id: "1", term: "Artificial Intelligence", category: "Technology", isActive: true, lastSearch: new Date() },
  { id: "2", term: "Quantum Computing", category: "Science", isActive: true, lastSearch: subMinutes(new Date(), 15) },
  { id: "3", term: "Renewable Energy", category: "Environment", isActive: true, lastSearch: subMinutes(new Date(), 45) },
  { id: "4", term: "SpaceX", category: "Business", isActive: false, lastSearch: subMinutes(new Date(), 120) },
  { id: "5", term: "Web3", category: "Technology", isActive: true, lastSearch: new Date() },
];

export const MOCK_NEWS: NewsItem[] = [
  {
    id: "1",
    title: "Breakthrough in Fusion Energy announced by Major Research Lab",
    summary: "Scientists have achieved a net energy gain in a fusion reaction for the second time, marking a significant step towards clean, limitless energy.",
    source: "TechCrunch",
    timestamp: subMinutes(new Date(), 5),
    relevanceScore: 98,
    keywords: ["Renewable Energy", "Science"],
    category: "science",
    url: "#"
  },
  {
    id: "2",
    title: "New AI Model Outperforms Humans in Complex Reasoning Tasks",
    summary: "The latest foundation model demonstrates unprecedented capabilities in mathematical problem solving and strategic planning.",
    source: "The Verge",
    timestamp: subMinutes(new Date(), 12),
    relevanceScore: 95,
    keywords: ["Artificial Intelligence", "Technology"],
    category: "technology",
    url: "#"
  },
  {
    id: "3",
    title: "Quantum Processor Hits 1000 Qubits Milestone",
    summary: "A leading tech giant reveals their new quantum chip, promising to revolutionize drug discovery and materials science.",
    source: "Wired",
    timestamp: subMinutes(new Date(), 25),
    relevanceScore: 89,
    keywords: ["Quantum Computing", "Technology"],
    category: "technology",
    url: "#"
  },
  {
    id: "4",
    title: "Global Markets React to New Environmental Regulations",
    summary: "Stock markets showed volatility today as new international green energy mandates come into effect.",
    source: "Bloomberg",
    timestamp: subMinutes(new Date(), 40),
    relevanceScore: 75,
    keywords: ["Renewable Energy", "Business"],
    category: "business",
    url: "#"
  },
  {
    id: "5",
    title: "Web3 Gaming Ecosystem Sees Record User Growth",
    summary: "Despite market fluctuations, blockchain-based gaming platforms reported a 200% increase in daily active users this quarter.",
    source: "CoinDesk",
    timestamp: subMinutes(new Date(), 55),
    relevanceScore: 82,
    keywords: ["Web3", "Technology"],
    category: "technology",
    url: "#"
  },
  {
    id: "6",
    title: "AI Regulation Summit Concludes with Historic Agreement",
    summary: "World leaders have signed a pact to ensure the safe development of artificial intelligence technologies.",
    source: "Reuters",
    timestamp: subMinutes(new Date(), 90),
    relevanceScore: 91,
    keywords: ["Artificial Intelligence", "Politics"],
    category: "politics",
    url: "#"
  }
];
