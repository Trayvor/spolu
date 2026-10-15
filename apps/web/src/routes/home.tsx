import { useQuery } from '@tanstack/react-query';
import { HealthResponseSchema } from '@ehub/shared';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { apiGet } from '@/lib/api';

// Placeholder: proves the API round trip. Task 13 builds the real home screen.
export function HomePage() {
  const health = useQuery({ queryKey: ['health'], queryFn: () => apiGet('/health', HealthResponseSchema) });

  return (
    <Card>
      <CardHeader>
        <CardTitle>eHub</CardTitle>
      </CardHeader>
      <CardContent>
        {health.data ? (
          <Badge variant={health.data.status === 'ok' ? 'success' : 'destructive'}>{health.data.status}</Badge>
        ) : null}
      </CardContent>
    </Card>
  );
}
