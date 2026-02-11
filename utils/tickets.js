const db = require('../database');

// チケット管理
const getOpenTicket = (userId) => db.prepare('SELECT channel_id FROM tickets WHERE user_id = ?').get(userId)?.channel_id;
const setOpenTicket = (userId, channelId) => db.prepare('INSERT OR REPLACE INTO tickets (user_id, channel_id) VALUES (?, ?)').run(userId, channelId);
const removeOpenTicket = (userId) => db.prepare('DELETE FROM tickets WHERE user_id = ?').run(userId);

module.exports = {
    getOpenTicket,
    setOpenTicket,
    removeOpenTicket
};

