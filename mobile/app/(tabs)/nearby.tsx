import React, { useEffect, useMemo, useState } from "react";
import * as Location from "expo-location";
import { Alert, Button, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";

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
      // Turn off sharing first (best-effort)
      if (userId) await updatePresence("red", true);
    } catch {}
    await signOut();
    router.replace("/login");
  }

  useEffect(() => {
    // On screen load: get profile + pending requests
    loadMyProfile();
    loadPendingOutgoing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  if (!userId) {
    // AuthGate should route, but keep this safe.
    return (
      <SafeAreaView style={{ flex: 1, padding: 16, justifyContent: "center" }}>
        <Text>Not signed in.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>Nearby</Text>

      <Text style={{ opacity: 0.8 }}>Signed in as: {session?.user?.email}</Text>

      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Display name</Text>
        <TextInput
          value={displayName}
          onChangeText={setDisplayName}
          style={{ borderWidth: 1, padding: 10, borderRadius: 10 }}
        />
        <Button title={loading ? "Saving..." : "Save Profile"} onPress={saveProfile} disabled={loading} />
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Status (current: {status.toUpperCase()})</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="Red" onPress={() => updatePresence("red")} disabled={loading} />
          <Button title="Orange" onPress={() => updatePresence("orange")} disabled={loading} />
          <Button title="Green" onPress={() => updatePresence("green")} disabled={loading} />
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Text style={{ fontWeight: "600" }}>Band (current: {bandLabel})</Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Button title="50" onPress={() => setBandM(50)} disabled={loading} />
          <Button title="100" onPress={() => setBandM(100)} disabled={loading} />
          <Button title="200" onPress={() => setBandM(200)} disabled={loading} />
          <Button title="500" onPress={() => setBandM(500)} disabled={loading} />
        </View>
      </View>

      <Text>My cell: {myCell ?? "-"}</Text>

      <Button title={loading ? "Checking..." : "Check Nearby"} onPress={fetchNearby} disabled={loading} />

      {nearby.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Text style={{ fontWeight: "700" }}>People nearby</Text>
          {nearby.map((p) => {
            const already = pendingTo.has(p.userId);
            return (
              <View
                key={p.userId}
                style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}
              >
                <Text>
                  {p.displayName} • {p.status.toUpperCase()}
                </Text>
                <Button
                  title={already ? "Requested" : "Request"}
                  onPress={() => sendRequest(p.userId)}
                  disabled={loading || already}
                />
              </View>
            );
          })}
        </View>
      ) : (
        <Text style={{ opacity: 0.7 }}>No one nearby yet.</Text>
      )}

      <Button title="Sign Out" onPress={handleSignOut} />
    </SafeAreaView>
  );
}
