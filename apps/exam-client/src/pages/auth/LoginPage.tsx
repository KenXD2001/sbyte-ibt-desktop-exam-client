import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Hash, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { loginSchema, type LoginFormData } from '@/lib/validations';
import { authAPI } from '@/api/auth';
import { useToast } from '@/hooks/useToast';
import { useAuth } from '@/hooks/useAuth';

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showError, showSuccess } = useToast();

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { rollNumber: '', password: '' },
  });

  const handleSubmit = async (data: LoginFormData) => {
    setIsSubmitting(true);
    try {
      const res = await authAPI.login({
        rollNumber: data.rollNumber.trim(),
        dateOfBirth: data.password.trim(),
      });
      login(res.data.accessToken, res.data.user);
      showSuccess('Login successful! Redirecting to your dashboard...', 'Welcome');
      navigate('/my-exams', { replace: true });
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Login failed. Please try again after some time..', 'Authentication Error');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted-foreground">Sign in to access your examinations.</p>
      </div>

      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        {/* Application ID */}
        <div className="space-y-2">
          <Label htmlFor="rollNumber">Application ID</Label>
          <div className="relative">
            <Hash className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
            <Input
              id="rollNumber"
              {...form.register('rollNumber')}
              placeholder="Application ID"
              className="pl-8"
            />
          </div>
          {form.formState.errors.rollNumber && (
            <p className="text-xs text-destructive">{form.formState.errors.rollNumber.message}</p>
          )}
        </div>

        {/* Password */}
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <Input
              id="password"
              {...form.register('password')}
              type={showPassword ? 'text' : 'password'}
              placeholder="Password"
              className="pr-9"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
          {form.formState.errors.password && (
            <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
          )}
        </div>

        {/* Submit */}
        <Button type="submit" disabled={isSubmitting} className="w-full">
          {isSubmitting ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Signing in...
            </span>
          ) : (
            'Sign in'
          )}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        By signing in, you agree to our{' '}
        <a href="#" className="text-primary hover:text-primary/80 font-medium transition-colors">Policies</a>.
      </p>
    </div>
  );
}
