// 游戏存档数据访问：一张表 kro_saves，每个用户一条记录，save_data 存整份 JSON。
const { cloud } = require('./cloud');
const { createTableAccess } = require('./workbuddy-data-access');

const saves = createTableAccess(cloud, {
    table: 'kro_saves',
    columns: ['id', 'save_data', 'updated_at'],
    orderBy: { column: 'updated_at', ascending: false },
    toRow(payload) {
        const row = {};
        if (Object.prototype.hasOwnProperty.call(payload, 'save_data')) row.save_data = payload.save_data;
        return row;
    },
});

module.exports = { saves };
