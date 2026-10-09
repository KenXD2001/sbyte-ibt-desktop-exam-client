import { GraduationCap } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-svh w-full items-center justify-center bg-gradient-to-b from-background via-muted/30 to-muted p-4 md:p-10">
      {/* Decorative background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 -right-48 size-[32rem] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-48 -left-48 size-[28rem] rounded-full bg-indigo-500/5 blur-3xl" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-sm animate-in fade-in-0 zoom-in-95 duration-300">
        <div className="rounded-xl border bg-card text-card-foreground shadow-lg">
          {/* Logo & Brand */}
          <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-4">
            <div className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md">
              <GraduationCap className="size-6 text-primary-foreground" />
            </div>
            <div className="text-center">
              <h1 className="text-lg font-semibold tracking-tight">Candidate Portal</h1>
              <p className="text-xs text-muted-foreground font-medium tracking-wide uppercase">Examination Portal</p>
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
