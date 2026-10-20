export type ShelfBook = {
  id: string
  title: string
  authors: string[]
  year: number | null
  coverUrl: string
  infoUrl: string
}

export type BookMatch = {
  id: string
  title: string
  authors: string[]
  year: number | null
  description: string
  coverUrl: string | null
  infoUrl: string
  why: string
}

export type SourceBook = {
  title: string
  authors: string[]
  year: number | null
  coverUrl: string | null
  infoUrl: string
  summary: string
}

export type BookGroup = {
  id: string
  label: string
  books: BookMatch[]
}

export type RecommendResponse = {
  books: BookMatch[]
  groups?: BookGroup[]
  sourceBook?: SourceBook
  note: string
  reading?: string
  usedAi: boolean
  error?: string
}
