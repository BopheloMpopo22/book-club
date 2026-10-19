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

export type RecommendResponse = {
  books: BookMatch[]
  note: string
  usedAi: boolean
  error?: string
}
