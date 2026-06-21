import type { Metadata } from 'next'
import '../src/index.css'
import '../src/App.css'

export const metadata: Metadata = {
  title: '心屿漂流',
  description: '夜间匿名情绪漂流产品',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
