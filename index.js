/**
 * Mark Running Late - PRODUCTION (Phoenix Encanto)
 *
 * Railway-deployable endpoint for Retell AI
 * Marks a client's upcoming appointment as running late in Meevo
 *
 * PRODUCTION CREDENTIALS - DO NOT USE FOR TESTING
 * Location: Keep It Cut - Phoenix Encanto (201664)
 */

const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// PRODUCTION Meevo API Configuration
const CONFIG = {
  AUTH_URL: 'https://marketplace.meevo.com/oauth2/token',
  API_URL: 'https://na1pub.meevo.com/publicapi/v1',
  CLIENT_ID: 'f6a5046d-208e-4829-9941-034ebdd2aa65',
  CLIENT_SECRET: '2f8feb2e-51f5-40a3-83af-3d4a6a454abe',
  TENANT_ID: '200507',
  LOCATION_ID: '201664'  // Phoenix Encanto
};

let token = null;
let tokenExpiry = null;

async function getToken() {
  if (token && tokenExpiry && Date.now() < tokenExpiry - 300000) return token;

  const res = await axios.post(CONFIG.AUTH_URL, {
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.CLIENT_SECRET
  });

  token = res.data.access_token;
  tokenExpiry = Date.now() + (res.data.expires_in * 1000);
  console.log('PRODUCTION: Got fresh token');
  return token;
}

async function callMeevoAPI(endpoint, method = 'GET', data = null) {
  const authToken = await getToken();

  const config = {
    method,
    url: `${CONFIG.API_URL}${endpoint}`,
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    }
  };

  if (data && method !== 'GET') {
    config.data = data;
  }

  const response = await axios(config);
  return response.data;
}

app.post('/mark-late', async (req, res) => {
  console.log('PRODUCTION: Mark running late request received');

  try {
    const { appointment_service_id, client_phone, client_email, location_id, estimated_minutes } = req.body;
    const locationId = location_id || CONFIG.LOCATION_ID;

    let aptServiceId = appointment_service_id;
    let appointmentDetails = null;

    // If no direct appointment_service_id, lookup by phone/email
    if (!aptServiceId && (client_phone || client_email)) {
      console.log('PRODUCTION: Looking up appointment by phone/email...');

      const clientsResult = await callMeevoAPI(
        `/clients?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`
      );

      let clientId = null;
      if (clientsResult?.data) {
        const normalizedPhone = client_phone?.replace(/\D/g, '').slice(-10);
        const normalizedEmail = client_email?.toLowerCase();

        const client = clientsResult.data.find(c => {
          if (normalizedPhone) {
            const cPhone = (c.primaryPhoneNumber || '').replace(/\D/g, '').slice(-10);
            if (cPhone === normalizedPhone) return true;
          }
          if (normalizedEmail && c.emailAddress?.toLowerCase() === normalizedEmail) return true;
          return false;
        });

        if (client) clientId = client.clientId;
      }

      if (!clientId) {
        return res.json({
          success: false,
          error: 'No client found with that phone number or email'
        });
      }

      const aptsResult = await callMeevoAPI(
        `/book/client/${clientId}/services?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}`
      );

      if (!aptsResult?.data?.length) {
        return res.json({
          success: false,
          error: 'No appointments found for this client'
        });
      }

      const now = new Date();
      const upcoming = aptsResult.data
        .filter(a => !a.isCancelled && new Date(a.startTime) >= now)
        .sort((a, b) => new Date(a.startTime) - new Date(b.startTime))[0];

      if (!upcoming) {
        return res.json({
          success: false,
          error: 'No upcoming appointments found to mark as running late'
        });
      }

      aptServiceId = upcoming.appointmentServiceId;
      appointmentDetails = upcoming;
      console.log(`PRODUCTION: Found upcoming appointment: ${aptServiceId}`);
    }

    if (!aptServiceId) {
      return res.json({
        success: false,
        error: 'Missing appointment_service_id or client_phone/client_email to lookup'
      });
    }

    // Get appointment details if not already fetched
    if (!appointmentDetails) {
      console.log('PRODUCTION: Getting appointment details...');
      const detailsResult = await callMeevoAPI(
        `/book/service/runninglate?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}&AppointmentServiceId=${aptServiceId}`
      );

      if (!detailsResult?.data) {
        return res.json({
          success: false,
          error: 'Could not get appointment details'
        });
      }

      appointmentDetails = detailsResult.data;
    }

    // PUT to mark as running late
    console.log('PRODUCTION: Marking appointment as running late...');

    const updateBody = {
      ServiceId: appointmentDetails.serviceId,
      ClientId: appointmentDetails.clientId,
      EmployeeId: appointmentDetails.employeeId,
      ConcurrencyCheckDigits: appointmentDetails.concurrencyCheckDigits,
      StartTime: appointmentDetails.startTime,
      IsRunningLate: true
    };

    const result = await callMeevoAPI(
      `/book/service/runninglate?TenantId=${CONFIG.TENANT_ID}&LocationId=${locationId}&AppointmentServiceId=${aptServiceId}`,
      'PUT',
      updateBody
    );

    console.log('PRODUCTION: Successfully marked appointment as running late!');
    return res.json({
      success: true,
      marked_late: true,
      appointment_service_id: aptServiceId,
      appointment_time: appointmentDetails.startTime,
      message: "Your barber has been notified that you're running late."
    });

  } catch (error) {
    console.error('PRODUCTION Mark late error:', error.response?.data || error.message);
    return res.json({
      success: false,
      error: error.response?.data?.error?.message || 'Failed to mark appointment as running late'
    });
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    environment: 'PRODUCTION',
    location: 'Phoenix Encanto',
    service: 'mark-running-late'
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PRODUCTION Mark Running Late service listening on port ${PORT}`);
});
