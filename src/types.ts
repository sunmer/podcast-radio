export const TOPICS = [
  'Technology',
  'Science',
  'Business',
  'History',
  'Society',
  'Health',
  'Arts',
  'Other',
] as const

export type Topic = (typeof TOPICS)[number]

export interface Recommendation {
  commentId: string
  commentUrl: string
  storyId: string
  storyTitle: string
  storyUrl: string
  author: string
  createdAt: string
  excerpt: string
  originalUrl: string
}

export interface Verification {
  checkedAt: string
  status: 'playable'
  httpStatus: number
  contentType: string
  acceptsByteRanges: boolean
  finalUrl: string
  signature: 'mp3' | 'm4a' | 'aac'
}

export interface Episode {
  id: string
  showName: string
  title: string
  description: string
  topics: Topic[]
  durationSeconds: number
  publishedAt: string | null
  artworkUrl: string
  audioUrl: string
  feedUrl: string | null
  sourceUrl: string
  recommendations: Recommendation[]
  recommendationCount: number
  verification: Verification
}

export interface CatalogAudit {
  discoveredComments: number
  resolvedEpisodes: number
  playableEpisodes: number
  rejected: Record<string, number>
  linkChecks: {
    artwork: number
    audio: number
    recommendations: number
    failed: number
  }
}

export interface Catalog {
  catalogVersion: 1
  generatedAt: string
  entries: Episode[]
  audit: CatalogAudit
}
