import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

// Toast escuro da marca (brand-950), rodapé central, acima da barra de ações em lote; no celular fica acima da barra inferior.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="bottom-center"
      offset={{ bottom: 84 }}
      mobileOffset={{ bottom: "calc(88px + env(safe-area-inset-bottom))" }}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-lime-400" />,
        info: <InfoIcon className="size-4 text-lime-400" />,
        warning: <TriangleAlertIcon className="size-4 text-amber-300" />,
        error: <OctagonXIcon className="size-4 text-rose-300" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!bg-brand-950 !text-white !border-brand-950 !shadow-lg !text-[13px] !font-medium !rounded-lg",
          description: "!text-white/70",
          actionButton: "!bg-lime-400 !text-brand-950",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
