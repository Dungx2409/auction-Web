-- Migration: Add notification_seen column to user_upgrade_requests table
-- This column tracks whether the user has seen the congratulation notification after being approved

ALTER TABLE auction.user_upgrade_requests 
ADD COLUMN IF NOT EXISTS notification_seen BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN auction.user_upgrade_requests.notification_seen IS 'Đã xem thông báo chúc mừng khi được duyệt';
