import { handleRecommend } from '../src/server/recommend.ts'

export const config = {
  runtime: 'edge',
}

export default function handler(request: Request): Promise<Response> {
  return handleRecommend(request)
}
