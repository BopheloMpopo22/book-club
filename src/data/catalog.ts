import { shelf } from './shelf.ts'

export type CatalogBook = {
  id: string
  title: string
  authors: string[]
  year: number | null
  coverUrl: string
  infoUrl: string
  genres: string[]
}

const cover = (id: number) => `https://covers.openlibrary.org/b/id/${id}-L.jpg`
const info = (isbn: string) => `https://openlibrary.org/isbn/${isbn}`

const shelfGenres: Record<string, string[]> = {
  'fourth-wing': ['Romantasy', 'Fantasy', 'Young adult'],
  'the-love-hypothesis': ['Romance'],
  'funny-story': ['Romance'],
  acotar: ['Fantasy', 'Romantasy'],
  icebreaker: ['Romance'],
  'divine-rivals': ['Fantasy', 'Young adult'],
  'happy-place': ['Romance'],
  'twisted-love': ['Romance'],
  'the-housemaid': ['Thriller'],
  powerless: ['Fantasy', 'Young adult'],
  'book-lovers': ['Romance'],
  'onyx-storm': ['Romantasy', 'Fantasy'],
  'deep-end': ['Romance'],
  'evelyn-hugo': ['Fiction'],
  'red-white': ['Romance'],
  'once-upon': ['Fantasy', 'Young adult'],
  'cruel-prince': ['Fantasy', 'Young adult'],
  'good-girls-guide': ['Mystery', 'Young adult'],
}

function extra(
  id: string,
  title: string,
  author: string,
  year: number,
  coverId: number,
  isbn: string,
  genres: string[],
): CatalogBook {
  return { id, title, authors: [author], year, coverUrl: cover(coverId), infoUrl: info(isbn), genres }
}

const christian: CatalogBook[] = [
  extra('redeeming-love', 'Redeeming Love', 'Francine Rivers', 1991, 8272833, '1590525132', ['Christian literature', 'Romance']),
  extra('screwtape', 'The Screwtape Letters', 'C. S. Lewis', 1942, 9779, '1850893748', ['Christian literature']),
  extra('hiding-place', 'The Hiding Place', 'Corrie ten Boom', 1971, 12817925, '9781565820128', ['Christian literature', 'Memoir']),
  extra('mere-christianity', 'Mere Christianity', 'C. S. Lewis', 1952, 6538891, '9780061947421', ['Christian literature', 'Nonfiction']),
  extra('present-darkness', 'This Present Darkness', 'Frank Peretti', 1986, 841925, '1451673337', ['Christian literature', 'Fantasy']),
  extra('narnia', 'The Lion, the Witch and the Wardrobe', 'C. S. Lewis', 1950, 8441376, '9780060765446', ['Christian literature', 'Fantasy']),
  extra('gilead', 'Gilead', 'Marilynne Robinson', 2004, 1472533, '0374705038', ['Christian literature', 'Fiction']),
  extra('great-divorce', 'The Great Divorce', 'C. S. Lewis', 1946, 6984074, '9780061947353', ['Christian literature']),
]

const nonfiction: CatalogBook[] = [
  extra('educated', 'Educated', 'Tara Westover', 2018, 8314077, '9722533797', ['Nonfiction', 'Memoir']),
  extra('atomic-habits', 'Atomic Habits', 'James Clear', 2018, 12539702, '1698414684', ['Nonfiction']),
  extra('sapiens', 'Sapiens', 'Yuval Noah Harari', 2011, 8634250, '9781716994982', ['Nonfiction', 'History']),
  extra('born-a-crime', 'Born a Crime', 'Trevor Noah', 2016, 8294078, '3896675907', ['Nonfiction', 'Memoir']),
  extra('braiding', 'Braiding Sweetgrass', 'Robin Wall Kimmerer', 2013, 7281575, '1571313567', ['Nonfiction']),
  extra('becoming', 'Becoming', 'Michelle Obama', 2018, 8824664, '8401024897', ['Nonfiction', 'Memoir']),
  extra('crying', 'Crying in H Mart', 'Michelle Zauner', 2021, 10462708, '9780593153895', ['Nonfiction', 'Memoir']),
  extra('warmth', 'The Warmth of Other Suns', 'Isabel Wilkerson', 2010, 10129368, '0141995157', ['Nonfiction', 'History']),
]

const mystery: CatalogBook[] = [
  extra('silent-patient', 'The Silent Patient', 'Alex Michaelides', 2019, 9407338, '1250230780', ['Thriller', 'Mystery']),
  extra('thursday', 'The Thursday Murder Club', 'Richard Osman', 2020, 10201431, '6180145350', ['Mystery']),
  extra('gone-girl', 'Gone Girl', 'Gillian Flynn', 2012, 8368314, '9780297859383', ['Thriller']),
  extra('and-then', 'And Then There Were None', 'Agatha Christie', 1939, 11172296, '0329251341', ['Mystery']),
  extra('the-maid', 'The Maid', 'Nita Prose', 2022, 11199954, '9780008435721', ['Mystery']),
  extra('woman-window', 'The Woman in the Window', 'A. J. Finn', 2018, 8315362, '9786059441643', ['Thriller']),
  extra('hunting-party', 'The Hunting Party', 'Lucy Foley', 2019, 8797519, '0008297134', ['Thriller']),
  extra('god-of-the-woods', 'The God of the Woods', 'Liz Moore', 2024, 14645734, '9780008663834', ['Mystery']),
]

const recent: CatalogBook[] = [
  extra('great-big', 'Great Big Beautiful Life', 'Emily Henry', 2025, 14861424, '0593955625', ['Romance']),
  extra('atmosphere', 'Atmosphere', 'Taylor Jenkins Reid', 2025, 15098710, '1529152984', ['Fiction']),
  extra('sunrise-reaping', 'Sunrise on the Reaping', 'Suzanne Collins', 2025, 14847912, '0702349070', ['Young adult']),
  extra('katabasis', 'Katabasis', 'R. F. Kuang', 2025, 15117021, '9780063021471', ['Fantasy']),
  extra('james-everett', 'James', 'Percival Everett', 2024, 15094964, '0593862732', ['Fiction']),
  extra('intermezzo', 'Intermezzo', 'Sally Rooney', 2024, 15248784, '0374602638', ['Fiction']),
  extra('colors-dark', 'All the Colors of the Dark', 'Chris Whitaker', 2024, 14643105, '0593798880', ['Thriller']),
  extra('wedding-people', 'The Wedding People', 'Alison Espach', 2024, 15127690, '1250899575', ['Fiction']),
  extra('demon-copperhead', 'Demon Copperhead', 'Barbara Kingsolver', 2022, 13141227, '9780571376490', ['Fiction']),
  extra('hail-mary', 'Project Hail Mary', 'Andy Weir', 2021, 11200092, '8328716801', ['Science fiction']),
  extra('midnight-library', 'The Midnight Library', 'Matt Haig', 2020, 10313767, '618014026X', ['Fiction']),
  extra('circe', 'Circe', 'Madeline Miller', 2018, 8739376, '9146235507', ['Fantasy']),
]

const romance: CatalogBook[] = shelf.map((book) => ({ ...book, genres: shelfGenres[book.id] ?? ['Fiction'] }))

export const shelves: { id: string; title: string; line: string; books: CatalogBook[] }[] = [
  {
    id: 'romance',
    title: 'On the shelf',
    line: 'Romance and young adult, the books readers pass around first. Pick one to find its neighbors.',
    books: romance,
  },
  {
    id: 'christian',
    title: 'Christian books',
    line: 'Faith, story, and the books people keep returning to.',
    books: christian,
  },
  {
    id: 'nonfiction',
    title: 'Nonfiction',
    line: 'Lives, history, and ideas.',
    books: nonfiction,
  },
  {
    id: 'mystery',
    title: 'Mystery and thriller',
    line: 'The ones that keep the light on.',
    books: mystery,
  },
]

const seen = new Set<string>()
export const catalog: CatalogBook[] = [...romance, ...christian, ...nonfiction, ...mystery, ...recent].filter((book) => {
  if (seen.has(book.id)) return false
  seen.add(book.id)
  return true
})
