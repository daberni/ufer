-- The booking a person kept when they resolved this hidden booking as its duplicate; null for bookings hidden for any other reason.
-- No foreign key, like transfer_id: showing the booking again clears it, and readers treat an unknown booking as unrecorded.
ALTER TABLE transactions ADD COLUMN duplicate_of_id TEXT;
