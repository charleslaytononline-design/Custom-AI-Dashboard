import type { AppProps } from 'next/app'
import '../styles/globals.css'

export default function App({ Component, pageProps }: AppProps) {
  const getLayout = (Component as any).getLayout ?? ((page: React.ReactNode) => page)
  return getLayout(<Component {...pageProps} />)
}
