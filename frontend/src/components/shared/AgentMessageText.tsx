// src/components/shared/AgentMessageText.tsx
// Los agentes de IA (Ayuda, Bienvenida, etc.) a veces devuelven texto con
// **negrita** en formato Markdown. Como los chats de agente muestran el
// texto tal cual (sin un parser de Markdown completo, para no arrastrar una
// librería nueva solo por esto), sin este componente los asteriscos dobles
// quedaban visibles literalmente en pantalla en vez de renderizarse en
// negrita. Este componente resuelve solo ese caso — **negrita** — que es
// el único formato que los prompts de los agentes usan.
export function AgentMessageText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i}>{part.slice(2, -2)}</strong>
        }
        return <span key={i}>{part}</span>
      })}
    </>
  )
}
