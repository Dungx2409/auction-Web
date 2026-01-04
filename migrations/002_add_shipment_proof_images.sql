-- Migration: Add proof_images column to order_shipments table
-- This allows sellers to upload proof images when confirming shipment

-- Check if column exists before adding
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'auction' 
        AND table_name = 'order_shipments' 
        AND column_name = 'proof_images'
    ) THEN
        ALTER TABLE auction.order_shipments ADD COLUMN proof_images TEXT;
        COMMENT ON COLUMN auction.order_shipments.proof_images IS 'JSON array of proof image paths uploaded by seller';
    END IF;
END $$;
