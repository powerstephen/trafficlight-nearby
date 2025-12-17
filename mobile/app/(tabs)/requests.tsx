import React, { useEffect, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { AppButton, Card, H1, H2, Muted, Pill, Screen } from "../../ui/components";

type RequestRow = {
  id: string | number;
  from_user: string;
  to_user: string;
  status: string;
  created_at: string;
  responded_at: string | null;
};

export default function RequestsScreen() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(false);
  const [incoming, setIncoming] = useState<RequestRow[]>([]);
  const [outgoing, setOutgoing] = useState<RequestRow[]>([]);
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  function showName(id: string) {
    return nameMap[id] || id.slice(0, 6);
  }

  async function loadNames(ids: string[]) {
    const unique = Array.from(new Set(ids)).filter(Boolean);
    if (unique.length === 0) return;

    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", unique);

    if (error) return;

    const next: Record<string, string> = {};
    (data ?? []).forEach((p: any) => {
      next[p.id] = p.display_name || p.id.slice(0, 6);
    });

    setNameMap((prev) => ({ ...prev, ...next }));
  }

  async function refresh(silent = false) {
    if (!userId) return;

    if (!silent) setLoading(true);
    try {
      const { data: reqs, error } = await supabase
        .from("connect_requests")
        .select("id, from_user, to_user, status, created_at, responded_at")
        .or(`from_user.eq.${userId},to_user.eq.${userId}`)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const all = (reqs ?? []) as RequestRow[];
      setIncoming(all.filter((r) => r.to_user === userId && r.status === "pending"));
      setOutgoing(all.filter((r) => r.from_user === userId && r.status === "pending"));
      await loadNames(all.flatMap((r) => [r.from_user, r.to_user]));
    } catch (e: any) {
      if (!silent) Alert.alert("Load error", e?.message ?? String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  function orderedPair(a: string, b: string) {
    return a < b ? { user_a: a, user_b: b } : { user_a: b, user_b: a };
  }

  async function acceptRequest(req: RequestRow) {
    if (!userId) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { error: upErr } = await supabase
        .from("connect_requests")
        .update({ status: "accepted", responded_at: nowIso })
        .eq("id", req.id);

      if (upErr) throw upErr;

      const pair = orderedPair(req.from_user, req.to_user);

      const { error: mErr } = await supabase.from("matches").insert({
        request_id: String(req.id),
        user_a: pair.user_a,
        user_b: pair.user_b,
      });

      if (mErr && String(mErr.code) !== "23505") throw mErr;

      await refresh(true);
      Alert.alert("Matched", "Request accepted.");
    } catch (e: any) {
      Alert.alert("Accept failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function declineRequest(req: RequestRow) {
    if (!userId) return;

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { error } = await supabase
        .from("connect_requests")
        .update({ status: "declined", responded_at: nowIso })
        .eq("id", req.id);

      if (error) throw error;

      await refresh(true);
      Alert.alert("Declined", "Request declined.");
    } catch (e: any) {
      Alert.alert("Decline failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Realtime auto-refresh
  useEffect(() => {
    if (!userId) return;

    const chIncoming = supabase
      .channel(`connect_requests:to:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "connect_requests", filter: `to_user=eq.${userId}` },
        () => refresh(true)
      )
      .subscribe();

    const chOutgoing = supabase
      .channel(`connect_requests:from:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "connect_requests", filter: `from_user=eq.${userId}` },
        () => refresh(true)
      )
      .subscribe();

    return () => {
      supabase.removeChannel(chIncoming);
      supabase.removeChannel(chOutgoing);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) {
    return (
      <Screen style={{ justifyContent: "center" }}>
        <Muted>Not signed in.</Muted>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 6 }}>
        <H1>Requests</H1>
        <Muted>Incoming and outgoing connection requests.</Muted>
      </View>

      <AppButton
        title={loading ? "Refreshing..." : "Refresh"}
        onPress={() => refresh()}
        disabled={loading}
        variant="secondary"
      />

      <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 24 }}>
        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <H2>Incoming</H2>
            <Pill text={`${incoming.length}`} tone={incoming.length ? "orange" : "neutral"} />
          </View>

          {incoming.length === 0 ? (
            <Muted>No incoming requests.</Muted>
          ) : (
            <View style={{ gap: 10 }}>
              {incoming.map((r) => (
                <View key={String(r.id)} style={{ borderWidth: 1, borderRadius: 14, padding: 12, gap: 10 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ gap: 2 }}>
                      <H2>{showName(r.from_user)}</H2>
                      <Muted>Wants to connect</Muted>
                    </View>
                    <Pill text="PENDING" tone="orange" />
                  </View>

                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <View style={{ flex: 1 }}>
                      <AppButton title="Accept" onPress={() => acceptRequest(r)} disabled={loading} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <AppButton title="Decline" onPress={() => declineRequest(r)} disabled={loading} variant="secondary" />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <H2>Outgoing</H2>
            <Pill text={`${outgoing.length}`} tone={outgoing.length ? "orange" : "neutral"} />
          </View>

          {outgoing.length === 0 ? (
            <Muted>No outgoing pending requests.</Muted>
          ) : (
            <View style={{ gap: 10 }}>
              {outgoing.map((r) => (
                <View key={String(r.id)} style={{ borderWidth: 1, borderRadius: 14, padding: 12, gap: 8 }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <View style={{ gap: 2 }}>
                      <H2>{showName(r.to_user)}</H2>
                      <Muted>Waiting for response</Muted>
                    </View>
                    <Pill text="PENDING" tone="orange" />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}
