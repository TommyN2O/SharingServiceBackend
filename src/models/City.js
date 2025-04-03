const pool = require('../config/database');
const lithuanianCities = require('../data/lithuanianCities');

class City {
  // Add a new city
  async create(name) {
    const query = `
      INSERT INTO cities (name)
      VALUES ($1)
      ON CONFLICT (name) DO NOTHING
      RETURNING *
    `;
    const result = await pool.query(query, [name]);
    return result.rows[0];
  }

  // Get all cities
  async getAll() {
    const query = 'SELECT * FROM cities ORDER BY name';
    const result = await pool.query(query);
    return result.rows;
  }

  // Reset cities table with predefined list
  async resetCities() {
    try {
      // Drop existing table
      await pool.query('DROP TABLE IF EXISTS cities CASCADE');
      
      // Create new table
      await pool.query(`
        CREATE TABLE cities (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL UNIQUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert all cities
      for (const city of lithuanianCities) {
        await this.create(city.name);
      }

      return { message: 'Cities table reset successfully' };
    } catch (error) {
      console.error('Error resetting cities:', error);
      throw error;
    }
  }

  // Get city by ID
  async getById(id) {
    const query = 'SELECT * FROM cities WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0];
  }

  // Get city by name
  async getByName(name) {
    const query = 'SELECT * FROM cities WHERE name = $1';
    const result = await pool.query(query, [name]);
    return result.rows[0];
  }

  // Initialize Lithuanian cities
  async initializeLithuanianCities() {
    const cities = [
      'Vilnius', 'Kaunas', 'Klaipėda', 'Šiauliai', 'Panevėžys', 'Alytus', 'Marijampolė',
      'Mažeikiai', 'Jonava', 'Utena', 'Kėdainiai', 'Telšiai', 'Visaginas', 'Tauragė',
      'Ukmergė', 'Plungė', 'Šilutė', 'Kretinga', 'Radviliškis', 'Druskininkai', 'Palanga',
      'Rokiškis', 'Biržai', 'Gargždai', 'Kuršėnai', 'Elektrėnai', 'Jurbarkas', 'Garliava',
      'Vilkaviškis', 'Raseiniai', 'Naujoji Akmenė', 'Anykščiai', 'Lentvaris', 'Grigiškės',
      'Prienai', 'Joniškis', 'Kelmė', 'Varėna', 'Kaišiadorys', 'Nemenčinė', 'Širvintos',
      'Pabradė', 'Šalčininkai', 'Švenčionys', 'Ignalina', 'Zarasai', 'Molėtai', 'Šilalė',
      'Šakiai', 'Kazlų Rūda', 'Kalvarija', 'Vievis', 'Eišiškės', 'Šeduva', 'Akmenė',
      'Tytuvėnai', 'Rūdiškės', 'Jieznas', 'Ežerėlis', 'Daugai', 'Simnas', 'Veisiejai',
      'Lazdijai', 'Švenčionėliai', 'Trakai', 'Rietavas', 'Skuodas', 'Pagėgiai', 'Joniškėlis',
      'Pasvalys', 'Kupiškis', 'Obeliai', 'Pandėlys', 'Ramygala', 'Troškūnai', 'Užpaliai',
      'Viešintos', 'Skaudvilė', 'Žagarė', 'Venta', 'Viekšniai', 'Žemaičių Naumiestis',
      'Sintautai', 'Pilviškiai', 'Virbalis', 'Kybartai', 'Viešvilė', 'Smalininkai',
      'Eržvilkas', 'Laukuva', 'Žemaičių Kalvarija', 'Tverai', 'Varniai', 'Tryškiai',
      'Luokė', 'Neringa', 'Rusnė', 'Švėkšna', 'Priekulė', 'Salantai', 'Mosėdis',
      'Ylakiai', 'Barstyčiai', 'Alsėdžiai', 'Kuliai', 'Panemunė'
    ];

    for (const city of cities) {
      await this.create(city);
    }
  }
}

module.exports = new City(); 