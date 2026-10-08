import ChallengeReportScreen from '@/components/challenges/ChallengeReport';

export default async function ChallengeReportPage({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params;
  return <ChallengeReportScreen challengeId={decodeURIComponent(challengeId)} />;
}
