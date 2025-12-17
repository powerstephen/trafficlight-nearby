import React, { useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import { Alert, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { AppButton, Card, H1, H2, Muted, Pill, Screen } from "../../ui/components";
import TrafficLight from "../../ui/TrafficLight";

function gridCellKey(lat: number, lng: number, bandM: number): string {
  const metersPerDegLat = 111_320;
  const latStep = bandM / metersPerDegLat;

  const cosLat = Math.cos((lat * Math.PI) / 180);
  const metersPerDegLng = metersPerDegLat * Math.max(cosLat, 0.01);
  const lngStep = bandM / metersPerDegLng;

  const latIndex = Math.round(lat / latStep);
  const lngIndex = Math.round(lng / lngStep);

  return `grid:${bandM}:${latIndex}:${lngIndex}`;
}

type PresenceRow = {
  user_id: string;
  status: "red" | "orange" | "green";
  h3_cell: string | null;
  expires_at: string | null;
};

type NearbyItem = {
  userId: string;
  displayName: string;
  status: "red" | "orange" | "green";
};

function toneForStatus(s: "red" | "orange" | "green") {
  return s === "red" ? "red" : s === "orange" ? "orange" : "green";
}

export default function NearbyScreen() {
  const router = useRouter();
  const { session, signOut } = useAuth();
  const userId = session?.user?.id ?? null;

  const [loading, setLoading] = useState(false);

  // Profile
  const [displayName, setDisplayName] = useState("");
  const [nameMap, setNameMap] = useState<Record<string, string>>({});

  // Presence / discovery
  const [status, setStatus] = useState<"red" | "orange" | "green">("red");
  const [bandM, setBandM] = useState<50 | 100 | 200 | 500>(500);
  const [myCell, setMyCell] = useState<string | null>(null);
  const [nearby, setNearby] = useState<NearbyItem[]>([]);
  const [pendingTo, setPendingTo] = useState<Set<string>>(new Set());

  const bandLabel = useMemo(() => `${bandM}m`, [bandM]);

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

  async function loadMyProfile() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    if (!error && data?.display_name) setDisplayName(data.display_name);
  }

  async function saveProfile() {
    if (!userId) return;
    setLoading(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({ id: userId, display_name: displayName }, { onConflict: "id" });
      if (error) throw error;
      Alert.alert("Saved", "Display name saved.");
    } catch (e: any) {
      Alert.alert("Save failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function loadPendingOutgoing() {
    if (!userId) return;
    const { data, error } = await supabase
      .from("connect_requests")
      .select("to_user")
      .eq("from_user", userId)
      .eq("status", "pending")
      .limit(200);

    if (error) return;

    const s = new Set<string>((data ?? []).map((r: any) => r.to_user));
    setPendingTo(s);
  }

  async function updatePresence(nextStatus: "red" | "orange" | "green", silent = false) {
    if (!userId) return;
    if (!silent) setLoading(true);

    try {
      const now = new Date();

      if (nextStatus === "red") {
        const expires = new Date(now.getTime() + 10 * 1000);

        const { error } = await supabase.from("presence").upsert(
          {
            user_id: userId,
            status: "red",
            band_m: bandM,
            h3_res: null,
            h3_cell: null,
            last_seen_at: now.toISOString(),
            expires_at: expires.toISOString(),
          },
          { onConflict: "user_id" }
        );
        if (error) throw error;

        setStatus("red");
        setMyCell(null);
        setNearby([]);
        if (!silent) Alert.alert("Sharing updated", "RED (off)");
        return;
      }

      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("Location permission not granted.");

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const cell = gridCellKey(pos.coords.latitude, pos.coords.longitude, bandM);
      const expires = new Date(now.getTime() + 2 * 60 * 1000);

      const { error } = await supabase.from("presence").upsert(
        {
          user_id: userId,
          status: nextStatus,
          band_m: bandM,
          h3_res: null,
          h3_cell: cell,
          last_seen_at: now.toISOString(),
          expires_at: expires.toISOString(),
        },
        { onConflict: "user_id" }
      );
      if (error) throw error;

      setStatus(nextStatus);
      setMyCell(cell);
      if (!silent) Alert.alert("Sharing updated", `${nextStatus.toUpperCase()} • ${bandLabel}`);
    } catch (e: any) {
      if (!silent) Alert.alert("Presence update failed", e?.message ?? String(e));
    } finally {
      if (!silent) setLoading(false);
    }
  }

  // Keep presence alive every 30s while orange/green
  useEffect(() => {
    if (!userId) return;
    if (status === "red") return;

    const t = setInterval(() => {
      updatePresence(status, true);
    }, 30_000);

    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, status, bandM]);

  async function fetchNearby() {
    if (!userId) return;
    if (!myCell) {
      Alert.alert("Nearby", "Set Orange or Green first to generate your cell.");
      return;
    }

    setLoading(true);
    try {
      const nowIso = new Date().toISOString();

      const { data: presenceRows, error } = await supabase
        .from("presence")
        .select("user_id,status,h3_cell,expires_at")
        .eq("h3_cell", myCell)
        .neq("user_id", userId)
        .neq("status", "red")
        .gt("expires_at", nowIso)
        .limit(20);

      if (error) throw error;

      const rows = (presenceRows ?? []) as PresenceRow[];
      const ids = rows.map((r) => r.user_id);
      await loadNames(ids);

      const items: NearbyItem[] = rows.map((r) => ({
        userId: r.user_id,
        displayName: showName(r.user_id),
        status: r.status,
      }));

      setNearby(items);
    } catch (e: any) {
      Alert.alert("Nearby error", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function sendRequest(toId: string) {
    if (!userId) return;
    if (toId === userId) return;

    setLoading(true);
    try {
      const { error } = await supabase.from("connect_requests").insert({
        from_user: userId,
        to_user: toId,
        status: "pending",
      });

      if (error) {
        if (String(error.code) === "23505") {
          Alert.alert("Request", "You already sent a pending request to this person.");
        } else {
          throw error;
        }
      } else {
        Alert.alert("Request", "Sent.");
      }

      await loadPendingOutgoing();
    } catch (e: any) {
      Alert.alert("Send failed", e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function handleSignOut() {
    try {
      if (userId) await updatePresence("red", true);
    } catch {}
    await signOut();
    router.replace("/login");
  }

  useEffect(() => {
    loadMyProfile();
    loadPendingOutgoing();
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
        <H1>Nearby</H1>
        <Muted>Signed in as {session?.user?.email}</Muted>
      </View>

      <Card style={{ gap: 12 }}>
        <H2>Profile</H2>
        <Text style={{ fontWeight: "600" }}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={{ borderWidth: 1, padding: 12, borderRadius: 12 }}
        />
        <AppButton title={loading ? "Saving..." : "Save Profile"} onPress={saveProfile} disabled={loading} />
      </Card>

      <Card style={{ gap: 12 }}>
        <H2>Sharing</H2>

        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <Pill text={`Band: ${bandLabel}`} tone="neutral" />
          <Pill text={`Status: ${status.toUpperCase()}`} tone={toneForStatus(status)} />
        </View>

        {/* Traffic light control */}
        <TrafficLight
          value={status}
          disabled={loading}
          onChange={(v) => updatePresence(v)}
        />

        <Muted>My cell: {myCell ?? "-"}</Muted>

        <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
          <AppButton title="50m" onPress={() => setBandM(50)} disabled={loading} variant={bandM === 50 ? "primary" : "secondary"} />
          <AppButton title="100m" onPress={() => setBandM(100)} disabled={loading} variant={bandM === 100 ? "primary" : "secondary"} />
          <AppButton title="200m" onPress={() => setBandM(200)} disabled={loading} variant={bandM === 200 ? "primary" : "secondary"} />
          <AppButton title="500m" onPress={() => setBandM(500)} disabled={loading} variant={bandM === 500 ? "primary" : "secondary"} />
        </View>

        <AppButton title={loading ? "Checking..." : "Check Nearby"} onPress={fetchNearby} disabled={loading} />
      </Card>

      <Card style={{ gap: 12 }}>
        <H2>People nearby</H2>
        {nearby.length === 0 ? (
          <Muted>No one nearby yet.</Muted>
        ) : (
          <View style={{ gap: 10 }}>
            {nearby.map((p) => {
              const already = pendingTo.has(p.userId);
              return (
                <View
                  key={p.userId}
                  style={{
                    borderWidth: 1,
                    borderRadius: 14,
                    padding: 12,
                    gap: 10,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ fontWeight: "800" }}>{p.displayName}</Text>
                    <Pill text={p.status.toUpperCase()} tone={toneForStatus(p.status)} />
                  </View>

                  <AppButton
                    title={already ? "Requested" : "Send request"}
                    onPress={() => sendRequest(p.userId)}
                    disabled={loading || already}
                    variant={already ? "secondary" : "primary"}
                  />
                </View>
              );
            })}
          </View>
        )}
      </Card>

      <AppButton title="Sign Out" onPress={handleSignOut} variant="secondary" />
    </Screen>
  );
}
