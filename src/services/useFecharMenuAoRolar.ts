import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/** Fecha menus flutuantes ao rolar qualquer contêiner ou a janela. */
export function useFecharMenuAoRolar<T>(aberto: boolean, definirMenu: Dispatch<SetStateAction<T | null>>) {
  useEffect(() => {
    if (!aberto) return
    const aoRolar = () => definirMenu(null)
    window.addEventListener('scroll', aoRolar, true)
    return () => window.removeEventListener('scroll', aoRolar, true)
  }, [aberto, definirMenu])
}
